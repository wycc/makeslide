import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../../db';
import { config } from '../../config';
import type { PageRow, PdfListItem, PdfRow } from '../../types';
import { coverImagePath, readMetadata, safeJoinPdfPath, videoPath, writeMetadata, youtubeOutlinePath } from '../../services/storage';
import { decodeSession, parseCookies } from '../auth';
import { ensureCoverThumbnail, ensurePageThumbnail, generateCoverThumbnail } from '../../services/thumbnails';
import {
  IdParamSchema,
  PageParamSchema,
  PollParamSchema,
  CreatePollBodySchema,
  DEFAULT_PDF_CATEGORY,
  UpdateCategoryBodySchema,
  UpdateVisibilityBodySchema,
  UpdatePromptBodySchema,
  UpdateTitleBodySchema,
  VotePollBodySchema,
  detectAudioMimeFromBuffer,
  errorResponse,
  nowIso,
  rowToDetail,
  rowToListItem,
  streamFile,
  timingRowsToPageMap,
} from './shared';
import { callChatJSON, transcribeAudioBuffer } from '../../services/openai';

interface PagePollRow {
  id: number;
  pdf_id: string;
  page_number: number;
  question: string;
  options_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface PageVoiceContextRow {
  page_number: number;
  text_path: string | null;
  script_path: string | null;
}

function readOptionalPageText(pdfId: string, relativePath: string | null): string {
  if (!relativePath) return '';
  try {
    const filePath = safeJoinPdfPath(pdfId, relativePath);
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

const VoicePollSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(6),
});

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

const ShareTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,128}$/, 'Invalid share token'),
});

const CreatePdfShareBodySchema = z.object({
  access: z.enum(['read_only', 'editable']),
});

function generateShareToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

function getShareMode(request: FastifyRequest): 'read_only' | 'editable' | null {
  const raw = request.headers['x-makeslide-share-mode'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'read_only' || value === 'editable') return value;
  return null;
}

function rowToPoll(row: PagePollRow) {
  let optionTexts: string[] = [];
  try {
    const parsed = JSON.parse(row.options_json) as unknown;
    if (Array.isArray(parsed)) optionTexts = parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    optionTexts = [];
  }
  const counts = db
    .prepare(`SELECT option_index, COUNT(*) AS votes FROM page_poll_votes WHERE poll_id = ? GROUP BY option_index`)
    .all(row.id) as Array<{ option_index: number; votes: number }>;
  const countByOption = new Map(counts.map((item) => [item.option_index, item.votes]));
  const options = optionTexts.map((text, idx) => ({ text, votes: countByOption.get(idx) ?? 0 }));
  return {
    id: row.id,
    pdf_id: row.pdf_id,
    page_number: row.page_number,
    question: row.question,
    options,
    total_votes: options.reduce((sum, option) => sum + option.votes, 0),
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function registerDetailRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/pdfs
  app.get('/api/pdfs', async (request, reply) => {
    const sub = sessionSub(request);
    const rows = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                 progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation, category,
                owner_sub, visibility,
                total_audio_duration_seconds,
                created_at, updated_at
           FROM pdfs
           ORDER BY created_at DESC`,
      )
      .all() as PdfRow[];
    const items: PdfListItem[] = rows.filter((row) => canReadPdf(sub, row)).map(rowToListItem);
    return reply.send(items);
  });

  // GET /api/pdfs/:id
  app.get('/api/pdfs/:id', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const row = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation,
                category,
                owner_sub, visibility,
                tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt,
                total_audio_duration_seconds,
                source_type, source_url, source_video_id, source_caption_language,
                created_at, updated_at
         FROM pdfs WHERE id = ?`,
      )
      .get(parsed.data.id) as PdfRow | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    }
    const sub = sessionSub(request);
    if (!canReadPdf(sub, row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報'));
    }
    const pages = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
         FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
      )
      .all(parsed.data.id) as PageRow[];
    const timingRows = db
      .prepare(
        `SELECT page_number, artifact, status, duration_ms, started_at, ended_at,
                sla_target_ms, sla_status, run_id, attempt, reason, error_code, error_message
           FROM page_artifact_timings
          WHERE pdf_id = ?`,
      )
      .all(parsed.data.id) as Parameters<typeof timingRowsToPageMap>[0];
    const detail = rowToDetail(row, pages, timingRowsToPageMap(timingRows));
    const shareMode = getShareMode(request);
    if (shareMode) {
      return reply.send({
        ...detail,
        share_mode: shareMode,
      });
    }
    return reply.send(detail);
  });

  app.post('/api/pdfs/:id/share', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const body = CreatePdfShareBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    }
    const row = db
      .prepare(`SELECT id FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as { id: string } | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    }

    const now = nowIso();
    const token = generateShareToken();
    db.prepare(
      `INSERT INTO pdf_shares (token, pdf_id, access, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(token, parsed.data.id, body.data.access, now, now);

    return reply.send({
      token,
      pdf_id: parsed.data.id,
      access: body.data.access,
      share_url: `${config.nbPrefix || ''}/#/play/${encodeURIComponent(parsed.data.id)}?share=${encodeURIComponent(token)}`,
      created_at: now,
      updated_at: now,
    });
  });

  app.get('/api/share/:token', async (request, reply) => {
    const parsed = ShareTokenParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid share token'));
    }
    const row = db
      .prepare(
        `SELECT s.token, s.pdf_id, s.access, s.created_at, s.updated_at,
                p.id AS existing_pdf_id
           FROM pdf_shares s
           LEFT JOIN pdfs p ON p.id = s.pdf_id
          WHERE s.token = ?`,
      )
      .get(parsed.data.token) as
      | {
          token: string;
          pdf_id: string;
          access: 'read_only' | 'editable';
          created_at: string;
          updated_at: string;
          existing_pdf_id: string | null;
        }
      | undefined;
    if (!row || !row.existing_pdf_id) {
      return reply.code(404).send(errorResponse('SHARE_NOT_FOUND', '分享連結不存在或已失效'));
    }
    return reply.send({
      token: row.token,
      pdf_id: row.pdf_id,
      access: row.access,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  });

  // PATCH /api/pdfs/:id/title
  app.patch('/api/pdfs/:id/title', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const body = UpdateTitleBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id } = parsed.data;
    const row = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!canEditPdf(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
    const now = nowIso();
    const title = body.data.title.trim();
    db.prepare(`UPDATE pdfs SET title = ?, updated_at = ? WHERE id = ?`).run(title, now, id);

    try {
      const metadata = await readMetadata(id);
      if (metadata) {
        metadata.title = title;
        metadata.updated_at = now;
        await writeMetadata(id, metadata);
      }
    } catch (err) {
      request.log.warn({ err, id }, 'Failed to update metadata title');
    }

    return reply.send({ id, title, updated_at: now });
  });

  async function handleUpdatePdfCategory(request: FastifyRequest, reply: FastifyReply) {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const body = UpdateCategoryBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id } = parsed.data;
    const row = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!canEditPdf(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }

    const now = nowIso();
    const category = body.data.category.trim();
    db.prepare(`UPDATE pdfs SET category = ?, updated_at = ? WHERE id = ?`).run(category, now, id);

    try {
      const metadata = await readMetadata(id);
      if (metadata) {
        metadata.category = category;
        metadata.updated_at = now;
        await writeMetadata(id, metadata);
      }
    } catch (err) {
      request.log.warn({ err, id }, 'Failed to update metadata category');
    }

    return reply.send({ id, category, updated_at: now });
  }

  app.patch('/api/pdfs/:id/category', handleUpdatePdfCategory);
  app.post('/api/pdfs/:id/category', handleUpdatePdfCategory);

  app.patch('/api/pdfs/:id/visibility', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const body = UpdateVisibilityBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id } = parsed.data;
    const row = db
      .prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!canEditPdf(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
    const now = nowIso();
    const visibility = body.data.visibility;
    db.prepare(`UPDATE pdfs SET visibility = ?, updated_at = ? WHERE id = ?`).run(visibility, now, id);

    try {
      const metadata = await readMetadata(id);
      if (metadata) {
        metadata.visibility = visibility;
        metadata.updated_at = now;
        await writeMetadata(id, metadata);
      }
    } catch (err) {
      request.log.warn({ err, id }, 'Failed to update metadata visibility');
    }

    return reply.send({ id, visibility, updated_at: now });
  });

  app.delete('/api/categories/:category', async (request, reply) => {
    const parsed = z.object({ category: z.string().min(1).max(80) }).safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid category parameter'));
    }
    const category = decodeURIComponent(parsed.data.category).trim();
    if (!category) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'category 不可為空'));
    }
    if (category === DEFAULT_PDF_CATEGORY) {
      return reply.code(409).send(errorResponse('INVALID_STATE', 'general 類別不可刪除'));
    }

    const now = nowIso();
    const rows = db.prepare(`SELECT id FROM pdfs WHERE category = ?`).all(category) as Array<{ id: string }>;
    db.prepare(`UPDATE pdfs SET category = ?, updated_at = ? WHERE category = ?`).run(DEFAULT_PDF_CATEGORY, now, category);

    for (const row of rows) {
      try {
        const metadata = await readMetadata(row.id);
        if (metadata) {
          metadata.category = DEFAULT_PDF_CATEGORY;
          metadata.updated_at = now;
          await writeMetadata(row.id, metadata);
        }
      } catch (err) {
        request.log.warn({ err, id: row.id, category }, 'Failed to sync metadata category after category delete');
      }
    }

    return reply.send({ category, reassigned_to: DEFAULT_PDF_CATEGORY, affected_count: rows.length, updated_at: now });
  });

  // GET /api/pdfs/:id/pages/:n/prompt
  app.get('/api/pdfs/:id/pages/:n/prompt', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const row = db
      .prepare(`SELECT text_path, updated_at FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { text_path: string | null; updated_at: string } | undefined;
    if (!row) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    let prompt: string | null = null;
    if (row.text_path) {
      try {
        prompt = await fs.promises.readFile(safeJoinPdfPath(id, row.text_path), 'utf8');
      } catch {
        prompt = null;
      }
    }
    return reply.send({ id, page_number: n, page_prompt: prompt, updated_at: row.updated_at });
  });

  // PATCH /api/pdfs/:id/pages/:n/prompt
  app.patch('/api/pdfs/:id/pages/:n/prompt', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const body = UpdatePromptBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const row = db
      .prepare(`SELECT text_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { text_path: string | null } | undefined;
    if (!row) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    if (!row.text_path) {
      return reply.code(409).send(errorResponse('INVALID_STATE', 'Page text_path not ready'));
    }
    const now = nowIso();
    const prompt = body.data.prompt.trim();
    try {
      await fs.promises.writeFile(safeJoinPdfPath(id, row.text_path), prompt, 'utf8');
    } catch {
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to write text prompt'));
    }
    db.prepare(`UPDATE pages SET updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(now, id, n);
    db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);
    return reply.send({ id, page_number: n, page_prompt: prompt || null, updated_at: now });
  });

  app.get('/api/pdfs/:id/pages/:n/polls', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const { id, n } = parsed.data;
    const page = db.prepare(`SELECT pdf_id FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n);
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    const rows = db
      .prepare(`SELECT id, pdf_id, page_number, question, options_json, is_active, created_at, updated_at FROM page_polls WHERE pdf_id = ? AND page_number = ? ORDER BY created_at DESC`)
      .all(id, n) as PagePollRow[];
    return reply.send({ polls: rows.map(rowToPoll) });
  });

  app.post('/api/pdfs/:id/pages/:n/polls', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const body = CreatePollBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const { id, n } = parsed.data;
    const page = db.prepare(`SELECT pdf_id FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n);
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    const now = nowIso();
    const options = body.data.options.map((option) => option.trim()).filter(Boolean);
    const result = db
      .prepare(`INSERT INTO page_polls (pdf_id, page_number, question, options_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`)
      .run(id, n, body.data.question.trim(), JSON.stringify(options), now, now);
    const row = db
      .prepare(`SELECT id, pdf_id, page_number, question, options_json, is_active, created_at, updated_at FROM page_polls WHERE id = ?`)
      .get(result.lastInsertRowid) as PagePollRow;
    return reply.code(201).send(rowToPoll(row));
  });

  app.post('/api/pdfs/:id/pages/:n/polls/voice', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid page parameter'));
    const { id, n } = parsed.data;
    const pdf = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!pdf) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdf)) return reply.code(403).send(errorResponse('FORBIDDEN', 'No edit permission'));

    const part = await request.file();
    if (!part) return reply.code(400).send(errorResponse('AUDIO_REQUIRED', 'audio file is required'));
    const audioBuffer = await part.toBuffer();
    if (audioBuffer.length === 0) return reply.code(400).send(errorResponse('AUDIO_EMPTY', 'audio file is empty'));
    const prompt = typeof part.fields.prompt === 'object' && 'value' in part.fields.prompt
      ? String(part.fields.prompt.value ?? '').trim().slice(0, 1000)
      : '';
    const transcript = await transcribeAudioBuffer(
      audioBuffer,
      part.filename || `voice-poll-${id}-${n}.webm`,
      part.mimetype || 'audio/webm',
    );
    if (!transcript) return reply.code(422).send(errorResponse('TRANSCRIPT_EMPTY', 'No speech could be transcribed'));

    const page = db
      .prepare(`SELECT page_number, text_path, script_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as PageVoiceContextRow | undefined;
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    const pageText = readOptionalPageText(id, page.text_path);
    const pageScript = readOptionalPageText(id, page.script_path);
    const generated = await callChatJSON({
      label: 'voice_poll_generation',
      schema: VoicePollSchema,
      maxTokens: 700,
      temperature: 0.4,
      messages: [
        { role: 'system', content: '你是教學現場的助教。請根據教師語音、可選提示詞、投影片文字與逐字稿，產生一個適合即時投票的單選問題。只回傳 JSON：{"question":"...","options":["...", "..."]}。選項 2 到 6 個，文字精簡。' },
        { role: 'user', content: `教師語音逐字稿：\n${transcript}\n\n教師補充提示詞：\n${prompt || '（無）'}\n\n本頁投影片文字：\n${pageText || '（無）'}\n\n本頁既有講稿：\n${pageScript || '（無）'}` },
      ],
    });
    const now = nowIso();
    const options = generated.data.options.map((option) => option.trim()).filter(Boolean).slice(0, 6);
    const result = db
      .prepare(`INSERT INTO page_polls (pdf_id, page_number, question, options_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`)
      .run(id, n, generated.data.question.trim(), JSON.stringify(options), now, now);
    const row = db
      .prepare(`SELECT id, pdf_id, page_number, question, options_json, is_active, created_at, updated_at FROM page_polls WHERE id = ?`)
      .get(result.lastInsertRowid) as PagePollRow;
    return reply.code(201).send({ poll: rowToPoll(row), transcript });
  });

  app.post('/api/pdfs/:id/polls/:pollId/votes', async (request, reply) => {
    const parsed = PollParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or poll id'));
    const body = VotePollBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const { id, pollId } = parsed.data;
    const row = db
      .prepare(`SELECT id, pdf_id, page_number, question, options_json, is_active, created_at, updated_at FROM page_polls WHERE id = ? AND pdf_id = ?`)
      .get(pollId, id) as PagePollRow | undefined;
    if (!row) return reply.code(404).send(errorResponse('POLL_NOT_FOUND', `Poll ${pollId} not found`));
    if (row.is_active !== 1) return reply.code(409).send(errorResponse('POLL_CLOSED', 'Poll is closed'));
    const options = JSON.parse(row.options_json) as string[];
    if (body.data.option_index >= options.length) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid option_index'));
    const now = nowIso();
    db.prepare(`INSERT INTO page_poll_votes (poll_id, voter_id, option_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(poll_id, voter_id) DO UPDATE SET option_index = excluded.option_index, updated_at = excluded.updated_at`)
      .run(pollId, body.data.voter_id, body.data.option_index, now, now);
    db.prepare(`UPDATE page_polls SET updated_at = ? WHERE id = ?`).run(now, pollId);
    const updated = db
      .prepare(`SELECT id, pdf_id, page_number, question, options_json, is_active, created_at, updated_at FROM page_polls WHERE id = ?`)
      .get(pollId) as PagePollRow;
    return reply.send(rowToPoll(updated));
  });

  // POST /api/pdfs/:id/cover/from-page/:n
  app.post('/api/pdfs/:id/cover/from-page/:n', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pageRow = db
      .prepare(`SELECT image_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { image_path: string | null } | undefined;
    if (!pageRow) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }
    if (!pageRow.image_path) {
      return reply.code(409).send(errorResponse('PAGE_IMAGE_NOT_FOUND', 'Page image not ready'));
    }

    let sourcePath: string;
    try {
      const abs = safeJoinPdfPath(id, pageRow.image_path);
      const legacyPng = abs.replace(/\.jpg$/i, '.png');
      const existingPath = fs.existsSync(abs) ? abs : fs.existsSync(legacyPng) ? legacyPng : null;
      if (!existingPath) {
        return reply.code(404).send(errorResponse('PAGE_IMAGE_NOT_FOUND', 'Page image file missing'));
      }
      sourcePath = existingPath;
    } catch (err) {
      request.log.warn({ err, id, n, stored: pageRow.image_path }, 'Path traversal blocked');
      return reply.code(400).send(errorResponse('INVALID_PATH', 'Invalid stored path'));
    }

    const now = nowIso();
    const cover = coverImagePath(id);
    try {
      await fs.promises.mkdir(path.dirname(cover), { recursive: true });
      await sharp(sourcePath).jpeg({ quality: 80, mozjpeg: true }).toFile(cover);
      await generateCoverThumbnail(id, cover);
    } catch (err) {
      request.log.error({ err, id, n, sourcePath }, 'Failed to update cover from page');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to update cover'));
    }

    db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);
    const coverCacheKey = encodeURIComponent(now);
    return reply.send({
      id,
      page_number: n,
      cover_url: `api/pdfs/${id}/cover?t=${coverCacheKey}`,
      cover_thumbnail_url: `api/pdfs/${id}/cover/thumbnail?t=${coverCacheKey}`,
      updated_at: now,
    });
  });

  // GET /api/pdfs/:id/cover
  app.get('/api/pdfs/:id/cover', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const exists = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(parsed.data.id) as { id: string } | undefined;
    if (!exists) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', 'PDF not found'));
    }
    const cover = coverImagePath(parsed.data.id);
    const legacyCoverPng = path.join(config.storageRoot, parsed.data.id, 'cover.png');

    if (!fs.existsSync(cover) && fs.existsSync(legacyCoverPng)) {
      try {
        await sharp(legacyCoverPng).jpeg({ quality: 80, mozjpeg: true }).toFile(cover);
      } catch (err) {
        request.log.warn({ err, id: parsed.data.id }, 'Failed to convert legacy cover.png to cover.jpg');
      }
    }

    const coverPath = fs.existsSync(cover) ? cover : fs.existsSync(legacyCoverPng) ? legacyCoverPng : null;
    if (!coverPath) {
      return reply.code(404).send(errorResponse('COVER_NOT_READY', 'Cover image not generated yet'));
    }
    const mime = coverPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return streamFile(reply, coverPath, mime, 'public, max-age=300');
  });

  // GET /api/pdfs/:id/cover/thumbnail
  app.get('/api/pdfs/:id/cover/thumbnail', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const exists = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(parsed.data.id) as { id: string } | undefined;
    if (!exists) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', 'PDF not found'));
    }
    const cover = coverImagePath(parsed.data.id);
    const legacyCoverPng = path.join(config.storageRoot, parsed.data.id, 'cover.png');
    const coverPath = fs.existsSync(cover) ? cover : fs.existsSync(legacyCoverPng) ? legacyCoverPng : null;
    if (!coverPath) {
      return reply.code(404).send(errorResponse('COVER_NOT_READY', 'Cover image not generated yet'));
    }
    const thumb = await ensureCoverThumbnail(parsed.data.id, coverPath);
    if (!thumb) return reply.code(404).send(errorResponse('COVER_NOT_READY', 'Cover thumbnail not generated yet'));
    return streamFile(reply, thumb, 'image/jpeg', 'public, max-age=3600');
  });

  // GET /api/pdfs/:id/video
  app.get('/api/pdfs/:id/video', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsed.data;
    const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as { id: string } | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const abs = videoPath(id);
    try {
      await fs.promises.access(abs, fs.constants.R_OK);
    } catch {
      return reply.code(404).send(errorResponse('VIDEO_NOT_FOUND', 'Video not found'));
    }
    return streamFile(reply, abs, 'video/mp4', 'public, max-age=3600');
  });

  // GET /api/pdfs/:id/outline
  app.get('/api/pdfs/:id/outline', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsed.data;
    const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as { id: string } | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const abs = youtubeOutlinePath(id);
    try {
      await fs.promises.access(abs, fs.constants.R_OK);
    } catch {
      return reply.code(404).send(errorResponse('OUTLINE_NOT_FOUND', 'Outline not found'));
    }
    return streamFile(reply, abs, 'text/markdown; charset=utf-8', 'public, max-age=60');
  });

  // GET /api/pdfs/:id/pages/:n/image
  app.get('/api/pdfs/:id/pages/:n/image', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pageRow = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
         FROM pages WHERE pdf_id = ? AND page_number = ?`,
      )
      .get(id, n) as PageRow | undefined;
    if (!pageRow || !pageRow.image_path) {
      return reply.code(404).send(errorResponse('PAGE_IMAGE_NOT_FOUND', 'Page image not found'));
    }
    let abs: string;
    try {
      abs = safeJoinPdfPath(id, pageRow.image_path);
    } catch (err) {
      request.log.warn({ err, id, n, stored: pageRow.image_path }, 'Path traversal blocked');
      return reply.code(400).send(errorResponse('INVALID_PATH', 'Invalid stored path'));
    }
    const legacyPng = abs.replace(/\.jpg$/i, '.png');
    let imagePath = abs;
    if (!fs.existsSync(imagePath) && fs.existsSync(legacyPng)) {
      try {
        await sharp(legacyPng).jpeg({ quality: 82, mozjpeg: true }).toFile(imagePath);
      } catch (err) {
        request.log.warn({ err, id, n }, 'Failed to convert legacy page png to jpg');
      }
    }
    if (!fs.existsSync(imagePath) && fs.existsSync(legacyPng)) {
      imagePath = legacyPng;
    }
    if (!fs.existsSync(imagePath)) {
      return reply.code(404).send(errorResponse('PAGE_IMAGE_NOT_FOUND', 'Page image file missing'));
    }
    const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return streamFile(reply, imagePath, mime, 'public, max-age=300');
  });

  // GET /api/pdfs/:id/pages/:n/thumbnail
  app.get('/api/pdfs/:id/pages/:n/thumbnail', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pageRow = db
      .prepare(
        `SELECT p.image_path, d.page_count
           FROM pages p
           JOIN pdfs d ON d.id = p.pdf_id
          WHERE p.pdf_id = ? AND p.page_number = ?`,
      )
      .get(id, n) as { image_path: string | null; page_count: number | null } | undefined;
    if (!pageRow?.image_path || !pageRow.page_count) {
      return reply.code(404).send(errorResponse('PAGE_IMAGE_NOT_FOUND', 'Page image not found'));
    }
    let abs: string;
    try {
      abs = safeJoinPdfPath(id, pageRow.image_path);
    } catch (err) {
      request.log.warn({ err, id, n, stored: pageRow.image_path }, 'Path traversal blocked');
      return reply.code(400).send(errorResponse('INVALID_PATH', 'Invalid stored path'));
    }
    const legacyPng = abs.replace(/\.jpg$/i, '.png');
    const imagePath = fs.existsSync(abs) ? abs : fs.existsSync(legacyPng) ? legacyPng : null;
    if (!imagePath) {
      return reply.code(404).send(errorResponse('PAGE_IMAGE_NOT_FOUND', 'Page image file missing'));
    }
    const thumb = await ensurePageThumbnail(id, n, pageRow.page_count, imagePath);
    if (!thumb) return reply.code(404).send(errorResponse('PAGE_IMAGE_NOT_FOUND', 'Page thumbnail missing'));
    return streamFile(reply, thumb, 'image/jpeg', 'public, max-age=3600');
  });

  // GET /api/pdfs/:id/pages/:n/text
  app.get('/api/pdfs/:id/pages/:n/text', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pageRow = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
         FROM pages WHERE pdf_id = ? AND page_number = ?`,
      )
      .get(id, n) as PageRow | undefined;
    if (!pageRow || !pageRow.text_path) {
      return reply.code(404).send(errorResponse('PAGE_TEXT_NOT_FOUND', 'Page text not found'));
    }
    let abs: string;
    try {
      abs = safeJoinPdfPath(id, pageRow.text_path);
    } catch (err) {
      request.log.warn({ err, id, n, stored: pageRow.text_path }, 'Path traversal blocked');
      return reply.code(400).send(errorResponse('INVALID_PATH', 'Invalid stored path'));
    }
    if (!fs.existsSync(abs)) {
      return reply.code(404).send(errorResponse('PAGE_TEXT_NOT_FOUND', 'Page text file missing'));
    }
    return streamFile(reply, abs, 'text/plain; charset=utf-8', 'private, max-age=60');
  });

  // GET /api/pdfs/:id/pages/:n/script
  app.get('/api/pdfs/:id/pages/:n/script', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pageRow = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
         FROM pages WHERE pdf_id = ? AND page_number = ?`,
      )
      .get(id, n) as PageRow | undefined;
    if (!pageRow || !pageRow.script_path) {
      return reply.code(404).send(errorResponse('PAGE_SCRIPT_NOT_FOUND', 'Page script not found'));
    }
    let abs: string;
    try {
      abs = safeJoinPdfPath(id, pageRow.script_path);
    } catch (err) {
      request.log.warn({ err, id, n, stored: pageRow.script_path }, 'Path traversal blocked');
      return reply.code(400).send(errorResponse('INVALID_PATH', 'Invalid stored path'));
    }
    if (!fs.existsSync(abs)) {
      return reply.code(404).send(errorResponse('PAGE_SCRIPT_NOT_FOUND', 'Page script file missing'));
    }
    return streamFile(reply, abs, 'text/plain; charset=utf-8', 'private, max-age=60');
  });

  // GET /api/pdfs/:id/pages/:n/audio (supports HTTP Range for <audio> seeking)
  app.get('/api/pdfs/:id/pages/:n/audio', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pageRow = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
         FROM pages WHERE pdf_id = ? AND page_number = ?`,
      )
      .get(id, n) as PageRow | undefined;
    if (!pageRow || !pageRow.audio_path) {
      return reply.code(404).send(errorResponse('PAGE_AUDIO_NOT_FOUND', 'Page audio not found'));
    }
    let abs: string;
    try {
      abs = safeJoinPdfPath(id, pageRow.audio_path);
    } catch (err) {
      request.log.warn({ err, id, n, stored: pageRow.audio_path }, 'Path traversal blocked');
      return reply.code(400).send(errorResponse('INVALID_PATH', 'Invalid stored path'));
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return reply.code(404).send(errorResponse('PAGE_AUDIO_NOT_FOUND', 'Page audio file missing'));
    }

    const size = stat.size;
    const rangeHeader = request.headers.range;
    reply.header('accept-ranges', 'bytes');
    let contentType: string = 'audio/mpeg';
    try {
      const head = Buffer.alloc(16);
      const fd = fs.openSync(abs, 'r');
      try {
        fs.readSync(fd, head, 0, 16, 0);
      } finally {
        fs.closeSync(fd);
      }
      contentType = detectAudioMimeFromBuffer(head);
    } catch {
      contentType = 'audio/mpeg';
    }
    reply.header('content-type', contentType);
    reply.header('cache-control', 'public, max-age=3600');

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!match) {
        reply.header('content-range', `bytes */${size}`);
        return reply.code(416).send();
      }
      const startRaw = match[1];
      const endRaw = match[2];
      let start: number;
      let end: number;
      if (startRaw === '' && endRaw !== '') {
        const suffixLen = Number(endRaw);
        if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
          reply.header('content-range', `bytes */${size}`);
          return reply.code(416).send();
        }
        start = Math.max(0, size - suffixLen);
        end = size - 1;
      } else {
        start = startRaw === '' ? 0 : Number(startRaw);
        end = endRaw === '' ? size - 1 : Number(endRaw);
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || end >= size) {
        reply.header('content-range', `bytes */${size}`);
        return reply.code(416).send();
      }
      const chunk = end - start + 1;
      reply.header('content-range', `bytes ${start}-${end}/${size}`);
      reply.header('content-length', String(chunk));
      reply.code(206);
      return reply.send(fs.createReadStream(abs, { start, end }));
    }

    reply.header('content-length', String(size));
    return reply.send(fs.createReadStream(abs));
  });
}
