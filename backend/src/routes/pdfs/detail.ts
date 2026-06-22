import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, getPageGenerationPrompts } from '../../db';
import { config } from '../../config';
import type { PageRow, PdfListItem, PdfRow, PdfSourceItem } from '../../types';
import { coverImagePath, pageTimelinePath, readMetadata, safeJoinPdfPath, videoPath, writeMetadata, youtubeOutlinePath, youtubeSourceAudioPath } from '../../services/storage';
import { isGithubSyncDirty } from '../../services/presentationGit';
import { getAccountDisplayNames } from '../../services/accountProfiles';
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
  errorResponse,
  nowIso,
  rowToDetail,
  rowToListItem,
  sendAudioFile,
  streamFile,
  timingRowsToPageMap,
} from './shared';
import { callChatJSON, transcribeAudioBuffer } from '../../services/openai';
import { generateTitle } from '../../worker/steps/generateTitle';
import { extractPdfText } from '../../worker/poppler';

interface PagePollRow {
  id: number;
  pdf_id: string;
  page_number: number;
  question: string;
  options_json: string;
  is_active: number;
  show_results: number;
  created_at: string;
  updated_at: string;
}

interface PageVoiceContextRow {
  page_number: number;
  text_path: string | null;
  script_path: string | null;
}

interface PdfSourceRow {
  id: number;
  pdf_id: string;
  source_kind: 'pdf' | 'txt' | 'youtube_caption' | 'youtube_audio';
  source_name: string | null;
  content_text: string;
  created_at: string;
  updated_at: string;
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

function hasOwnerOrLegacyAccess(sub: string | null, row: Pick<PdfRow, 'owner_sub'>): boolean {
  if (!row.owner_sub) return true;
  return Boolean(sub && row.owner_sub === sub);
}

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

// Stricter variant for this file's destructive/irreversible poll routes: deleting a poll outright,
// and resetting (wiping) everyone's submitted votes. These are a different tier of action from
// submitting a vote (POST /polls/:pollId/votes), which intentionally stays open to any reader via
// canReadPdf() so anonymous classroom viewers can answer polls — that design choice has nothing to
// do with whether an anonymous visitor should be able to delete the whole poll or erase every
// participant's vote history. Reuses canEditPdf()'s owner/public_editable logic but additionally
// requires an authenticated session before the public_editable fallback applies. Mirrors
// delete.ts's canEditPdf() fix.
function canDestructivelyEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return Boolean(sub) && row.visibility === 'public_editable';
}

const ShareTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,128}$/, 'Invalid share token'),
});

const CreatePdfShareBodySchema = z.object({
  access: z.enum(['read_only', 'editable']),
  visibility: z.enum(['private', 'public', 'public_editable']).optional(),
  expires_days: z.number().int().min(1).max(3650).optional(),
});

function accessToVisibility(access: 'read_only' | 'editable'): 'public' | 'public_editable' {
  return access === 'editable' ? 'public_editable' : 'public';
}

function generateShareToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

function getShareMode(request: FastifyRequest): 'read_only' | 'editable' | null {
  const raw = request.headers['x-makeslide-share-mode'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'read_only' || value === 'editable') return value;
  return null;
}

function getShareToken(request: FastifyRequest): string | null {
  const rawHeader = request.headers['x-makeslide-share-token'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  const query = request.query as Record<string, unknown> | undefined;
  const rawQuery = query?.share;
  const queryValue = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;
  return typeof queryValue === 'string' && queryValue.trim() ? queryValue.trim() : null;
}

function shareAccessForPdf(request: FastifyRequest, pdfId: string): 'read_only' | 'editable' | null {
  const token = getShareToken(request);
  if (!token || !ShareTokenParamSchema.safeParse({ token }).success) return null;
  const row = db
    .prepare(
      `SELECT access, expires_at
         FROM pdf_shares
        WHERE token = ? AND pdf_id = ?`,
    )
    .get(token, pdfId) as { access: 'read_only' | 'editable'; expires_at: string | null } | undefined;
  if (!row) return null;
  if (row.expires_at && row.expires_at < new Date().toISOString()) return null;
  return row.access;
}

function isShareTokenExpired(request: FastifyRequest, pdfId: string): boolean {
  const token = getShareToken(request);
  if (!token || !ShareTokenParamSchema.safeParse({ token }).success) return false;
  const row = db
    .prepare(`SELECT expires_at FROM pdf_shares WHERE token = ? AND pdf_id = ?`)
    .get(token, pdfId) as { expires_at: string | null } | undefined;
  if (!row) return false;
  return Boolean(row.expires_at && row.expires_at < new Date().toISOString());
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
  const answered = db
    .prepare(`SELECT COUNT(DISTINCT voter_id) AS count FROM page_poll_votes WHERE poll_id = ?`)
    .get(row.id) as { count: number } | undefined;
  return {
    id: row.id,
    pdf_id: row.pdf_id,
    page_number: row.page_number,
    question: row.question,
    options,
    total_votes: options.reduce((sum, option) => sum + option.votes, 0),
    answered_count: answered?.count ?? 0,
    is_active: row.is_active === 1,
    show_results: row.show_results === 1,
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
                github_synced_commit, github_synced_at,
                tags,
                created_at, updated_at
           FROM pdfs
           ORDER BY created_at DESC`,
      )
      .all() as PdfRow[];
    // 沒有 owner 的舊資料不在列表中顯示（仍可透過直接連結存取，canReadPdf() 對它們的權限不變）。
    const readableRows = rows.filter((row) => row.owner_sub != null && canReadPdf(sub, row));
    const ownerNames = getAccountDisplayNames(readableRows.map((row) => row.owner_sub));
    const items: PdfListItem[] = await Promise.all(
      readableRows.map(async (row) => {
        const item = rowToListItem(row);
        item.owner_name = row.owner_sub ? ownerNames.get(row.owner_sub) ?? null : null;
        if (row.github_synced_commit) {
          item.github_sync_dirty = await isGithubSyncDirty(row.id, row.github_synced_commit);
        }
        return item;
      }),
    );
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
                tts_voice, tts_speed, host_mode, script_max_chars_per_page, image_style_prompt,
                total_audio_duration_seconds,
                source_type, source_url, source_video_id, source_caption_language,
                tags,
                created_at, updated_at
         FROM pdfs WHERE id = ?`,
      )
      .get(parsed.data.id) as PdfRow | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    }
    const sub = sessionSub(request);
    const shareAccess = shareAccessForPdf(request, parsed.data.id);
    if (!shareAccess && isShareTokenExpired(request, parsed.data.id)) {
      return reply.code(410).send(errorResponse('SHARE_LINK_EXPIRED', '此分享連結已過期'));
    }
    if (!shareAccess && !canReadPdf(sub, row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報'));
    }
    const pages = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, render_type, animation_spec_path,
                status, error_message, created_at, updated_at
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
    const sources = db
      .prepare(
        `SELECT id, pdf_id, source_kind, source_name, content_text, created_at, updated_at
           FROM pdf_sources
          WHERE pdf_id = ?
          ORDER BY created_at ASC, id ASC`,
      )
      .all(parsed.data.id) as PdfSourceRow[];
    const sourceItems: PdfSourceItem[] = sources.map((s) => ({
      id: s.id,
      pdf_id: s.pdf_id,
      source_kind: s.source_kind,
      source_name: s.source_name,
      content_text: s.content_text,
      created_at: s.created_at,
      updated_at: s.updated_at,
    }));
    const shareMode = shareAccess ?? getShareMode(request);
    // 分享連結的唯讀/可編輯模式只限制其他訪客；owner（或沒有 owner 的舊資料）
    // 永遠視為可讀寫，前端用這個旗標避免把自己設定的唯讀分享套用到自己身上。
    const isOwner = hasOwnerOrLegacyAccess(sub, row);
    if (shareMode) {
      return reply.send({
        ...detail,
        sources: sourceItems,
        share_mode: shareMode,
        is_owner: isOwner,
        is_authenticated: Boolean(sub),
      });
    }
    return reply.send({ ...detail, sources: sourceItems, is_owner: isOwner, is_authenticated: Boolean(sub) });
  });

  app.post('/api/pdfs/:id/sources/txt', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const body = z
      .object({
        source_name: z.string().trim().max(200).optional(),
        content_text: z.string().trim().min(1).max(120000),
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    }
    const row = db
      .prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    const sub = sessionSub(request);
    if (!canEditPdf(sub, row)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));

    const now = nowIso();
    const result = db
      .prepare(
        `INSERT INTO pdf_sources (pdf_id, source_kind, source_name, content_text, created_at, updated_at)
         VALUES (?, 'txt', ?, ?, ?, ?)`,
      )
      .run(
        parsed.data.id,
        body.data.source_name?.trim() || null,
        body.data.content_text.trim(),
        now,
        now,
      );
    const inserted = db
      .prepare(
        `SELECT id, pdf_id, source_kind, source_name, content_text, created_at, updated_at
           FROM pdf_sources
          WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as PdfSourceRow;
    return reply.code(201).send(inserted);
  });

  app.post('/api/pdfs/:id/sources/pdf', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const part = await request.file();
    if (!part) return reply.code(400).send(errorResponse('FILE_REQUIRED', 'file is required'));
    const row = db
      .prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    const sub = sessionSub(request);
    if (!canEditPdf(sub, row)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));

    const fileName = part.filename || 'source.pdf';
    const lower = fileName.toLowerCase();
    if (!lower.endsWith('.pdf') && part.mimetype !== 'application/pdf') {
      return reply.code(400).send(errorResponse('INVALID_UPLOAD_TYPE', 'Only PDF is supported'));
    }
    const chunks: Buffer[] = [];
    for await (const chunk of part.file) chunks.push(chunk as Buffer);
    const data = Buffer.concat(chunks);
    if (data.length === 0) return reply.code(400).send(errorResponse('FILE_REQUIRED', 'file is empty'));

    let text = '';
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-source-pdf-'));
    const tempPdfPath = path.join(tempDir, 'source.pdf');
    try {
      await fs.promises.writeFile(tempPdfPath, data);
      text = (await extractPdfText(tempPdfPath)).trim();
    } catch {
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to parse PDF text'));
    } finally {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
    if (!text) return reply.code(422).send(errorResponse('EMPTY_SOURCE_TEXT', 'No readable text in uploaded PDF'));

    const now = nowIso();
    const result = db
      .prepare(
        `INSERT INTO pdf_sources (pdf_id, source_kind, source_name, content_text, created_at, updated_at)
         VALUES (?, 'pdf', ?, ?, ?, ?)`,
      )
      .run(parsed.data.id, fileName, text.slice(0, 120000), now, now);
    const inserted = db
      .prepare(
        `SELECT id, pdf_id, source_kind, source_name, content_text, created_at, updated_at
           FROM pdf_sources
          WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as PdfSourceRow;
    return reply.code(201).send(inserted);
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
      .prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    }
    if (!hasOwnerOrLegacyAccess(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '只有簡報擁有者可以建立分享連結'));
    }

    const visibility = body.data.visibility ?? accessToVisibility(body.data.access);
    const now = nowIso();
    if (row.visibility !== visibility) {
      db.prepare(`UPDATE pdfs SET visibility = ?, updated_at = ? WHERE id = ?`).run(visibility, now, parsed.data.id);
      try {
        const metadata = await readMetadata(parsed.data.id);
        if (metadata) {
          metadata.visibility = visibility;
          metadata.updated_at = now;
          await writeMetadata(parsed.data.id, metadata);
        }
      } catch (err) {
        request.log.warn({ err, id: parsed.data.id }, 'Failed to update metadata visibility while creating share');
      }
    }

    const expiresDays = body.data.expires_days;
    const expiresAt = expiresDays
      ? new Date(Date.now() + expiresDays * 86400000).toISOString()
      : null;

    const existing = db
      .prepare(
        `SELECT token, pdf_id, access, created_at, updated_at, expires_at
           FROM pdf_shares
          WHERE pdf_id = ? AND access = ?
          ORDER BY created_at ASC
          LIMIT 1`,
      )
      .get(parsed.data.id, body.data.access) as
      | {
          token: string;
          pdf_id: string;
          access: 'read_only' | 'editable';
          created_at: string;
          updated_at: string;
          expires_at: string | null;
        }
      | undefined;
    if (existing) {
      if (expiresDays !== undefined && existing.expires_at !== expiresAt) {
        db.prepare(`UPDATE pdf_shares SET expires_at = ?, updated_at = ? WHERE token = ?`).run(expiresAt, now, existing.token);
      }
      return reply.send({
        token: existing.token,
        pdf_id: existing.pdf_id,
        access: existing.access,
        visibility,
        expires_at: expiresDays !== undefined ? expiresAt : existing.expires_at,
        share_url: `${config.nbPrefix || ''}/#/play/${encodeURIComponent(existing.pdf_id)}?share=${encodeURIComponent(existing.token)}`,
        created_at: existing.created_at,
        updated_at: now,
      });
    }

    const token = generateShareToken();
    db.prepare(
      `INSERT INTO pdf_shares (token, pdf_id, access, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(token, parsed.data.id, body.data.access, expiresAt, now, now);

    return reply.send({
      token,
      pdf_id: parsed.data.id,
      access: body.data.access,
      visibility,
      expires_at: expiresAt,
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

  // POST /api/pdfs/:id/regenerate-title
  app.post('/api/pdfs/:id/regenerate-title', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsed.data;
    const row = db
      .prepare(`SELECT id, owner_sub, visibility, page_count, user_prompt FROM pdfs WHERE id = ?`)
      .get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility' | 'page_count' | 'user_prompt'> | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!hasOwnerOrLegacyAccess(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '只有簡報擁有者可以變更分享狀態'));
    }

    const pageCount =
      typeof row.page_count === 'number' && Number.isFinite(row.page_count) && row.page_count > 0
        ? row.page_count
        : (db
            .prepare(`SELECT COUNT(*) AS c FROM pages WHERE pdf_id = ?`)
            .get(id) as { c: number } | undefined)?.c ?? 0;
    if (pageCount <= 0) {
      return reply.code(409).send(errorResponse('INVALID_STATE', '尚無可用內容可重新生成標題'));
    }

    const result = await generateTitle(id, pageCount, {
      userPrompt: row.user_prompt ?? null,
    });
    const now = nowIso();
    db.prepare(`UPDATE pdfs SET title = ?, updated_at = ? WHERE id = ?`).run(result.title, now, id);

    try {
      const metadata = await readMetadata(id);
      if (metadata) {
        metadata.title = result.title;
        metadata.updated_at = now;
        await writeMetadata(id, metadata);
      }
    } catch (err) {
      request.log.warn({ err, id }, 'Failed to update metadata title after regenerate-title');
    }

    return reply.send({ id, title: result.title, updated_at: now, source: result.source });
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

  // PATCH /api/pdfs/:id/tags
  app.patch('/api/pdfs/:id/tags', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const body = z.object({ tags: z.string().max(500, 'tags 不可超過 500 字元') }).safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
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
    const tags = body.data.tags.trim();
    db.prepare(`UPDATE pdfs SET tags = ?, updated_at = ? WHERE id = ?`).run(tags, now, id);
    return reply.send({ id, tags, updated_at: now });
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
    // 這個端點原本完全沒有身份檢查、且 UPDATE 不限 owner_sub：任何人（包含未登入訪客）
    // 只要猜到一個分類名稱字串，就能把該分類底下「所有帳號」的簡報一次性改回 general，
    // 等同跨帳號的全域資料汙染。分類本身是每個帳號自己在首頁列表上用來分組的個人化標籤
    // （GET /api/pdfs 也只會顯示 sub 本人可讀的簡報），所以「刪除分類」要求必須登入，
    // 且只能重新分類「目前登入帳號自己擁有」（owner_sub = sub）的簡報；沒有 owner_sub 的
    // 舊資料本來就不會出現在使用者的首頁列表（見上面 GET /api/pdfs 的同類別註解），
    // 也維持不受這個端點影響。
    const sub = sessionSub(request);
    if (!sub) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '請先登入才能刪除類別'));
    }

    const now = nowIso();
    const rows = db.prepare(`SELECT id FROM pdfs WHERE category = ? AND owner_sub = ?`).all(category, sub) as Array<{ id: string }>;
    db.prepare(`UPDATE pdfs SET category = ?, updated_at = ? WHERE category = ? AND owner_sub = ?`).run(DEFAULT_PDF_CATEGORY, now, category, sub);

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
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的頁面提示詞'));
    }
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
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的頁面提示詞'));
    }
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
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的投票'));
    }
    const page = db.prepare(`SELECT pdf_id FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n);
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    const rows = db
      .prepare(`SELECT id, pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at FROM page_polls WHERE pdf_id = ? AND page_number = ? ORDER BY created_at DESC`)
      .all(id, n) as PagePollRow[];
    return reply.send({ polls: rows.map(rowToPoll) });
  });

  app.post('/api/pdfs/:id/pages/:n/polls', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const body = CreatePollBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const { id, n } = parsed.data;
    const pdf = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!pdf) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdf)) return reply.code(403).send(errorResponse('FORBIDDEN', 'No edit permission'));
    const page = db.prepare(`SELECT pdf_id FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n);
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    const now = nowIso();
    const options = body.data.options.map((option) => option.trim()).filter(Boolean);
    const result = db
      .prepare(`INSERT INTO page_polls (pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`)
      .run(id, n, body.data.question.trim(), JSON.stringify(options), body.data.show_results ? 1 : 0, now, now);
    const row = db
      .prepare(`SELECT id, pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at FROM page_polls WHERE id = ?`)
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

  app.delete('/api/pdfs/:id/polls/:pollId', async (request, reply) => {
    const parsed = PollParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or poll id'));
    const { id, pollId } = parsed.data;
    const pdf = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!pdf) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canDestructivelyEditPdf(sessionSub(request), pdf)) return reply.code(403).send(errorResponse('FORBIDDEN', 'No edit permission'));
    const row = db.prepare(`SELECT id FROM page_polls WHERE id = ? AND pdf_id = ?`).get(pollId, id) as { id: number } | undefined;
    if (!row) return reply.code(404).send(errorResponse('POLL_NOT_FOUND', `Poll ${pollId} not found`));
    db.prepare(`DELETE FROM page_polls WHERE id = ? AND pdf_id = ?`).run(pollId, id);
    return reply.code(204).send();
  });

  app.post('/api/pdfs/:id/polls/:pollId/votes', async (request, reply) => {
    const parsed = PollParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or poll id'));
    const body = VotePollBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const { id, pollId } = parsed.data;
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限對此簡報的投票進行投票'));
    }
    const row = db
      .prepare(`SELECT id, pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at FROM page_polls WHERE id = ? AND pdf_id = ?`)
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
      .prepare(`SELECT id, pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at FROM page_polls WHERE id = ?`)
      .get(pollId) as PagePollRow;
    return reply.send(rowToPoll(updated));
  });

  app.post('/api/pdfs/:id/polls/:pollId/reset-votes', async (request, reply) => {
    const parsed = PollParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or poll id'));
    const { id, pollId } = parsed.data;
    const pdf = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!pdf) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canDestructivelyEditPdf(sessionSub(request), pdf)) return reply.code(403).send(errorResponse('FORBIDDEN', 'No edit permission'));
    const row = db
      .prepare(`SELECT id, pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at FROM page_polls WHERE id = ? AND pdf_id = ?`)
      .get(pollId, id) as PagePollRow | undefined;
    if (!row) return reply.code(404).send(errorResponse('POLL_NOT_FOUND', `Poll ${pollId} not found`));

    const now = nowIso();
    db.prepare(`DELETE FROM page_poll_votes WHERE poll_id = ?`).run(pollId);
    db.prepare(`UPDATE page_polls SET updated_at = ? WHERE id = ?`).run(now, pollId);

    const updated = db
      .prepare(`SELECT id, pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at FROM page_polls WHERE id = ?`)
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
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的封面'));
    }
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
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(parsed.data.id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', 'PDF not found'));
    }
    if (!shareAccessForPdf(request, parsed.data.id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的封面'));
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
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(parsed.data.id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', 'PDF not found'));
    }
    if (!shareAccessForPdf(request, parsed.data.id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的封面縮圖'));
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
    const row = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的影片'));
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
    const row = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的大綱'));
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
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的投影片圖片'));
    }
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
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的投影片縮圖'));
    }
    const pageRow = db
      .prepare(`SELECT image_path, page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { image_path: string | null; page_uid: string } | undefined;
    if (!pageRow?.image_path) {
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
    const thumb = await ensurePageThumbnail(id, pageRow.page_uid, imagePath);
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
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的頁面文字'));
    }
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
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的逐字稿'));
    }
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

  // GET /api/pdfs/:id/pages/:n/subtitle-timeline
  // Only present when this account generated the page's audio with subtitleSyncMode 'whisper';
  // absent (timeline: null) whenever the page was synthesized in (or hasn't been re-synthesized
  // since switching away from) Whisper mode — the frontend transparently falls back to its own
  // character-count estimate in that case, so this 404-as-null path is the expected common case.
  app.get('/api/pdfs/:id/pages/:n/subtitle-timeline', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的字幕時間軸'));
    }
    const pageRow = db
      .prepare(`SELECT page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as Pick<PageRow, 'page_uid'> | undefined;
    if (!pageRow) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }
    // page_uid is generated internally (nanoid) and never user-supplied, so pageTimelinePath()
    // can be used directly here — unlike the script route above, there's no DB-stored relative
    // path to defend against.
    const abs = pageTimelinePath(id, pageRow.page_uid);
    if (!fs.existsSync(abs)) {
      return reply.code(200).send({ timeline: null });
    }
    try {
      const raw = await fs.promises.readFile(abs, 'utf8');
      return reply.code(200).send({ timeline: JSON.parse(raw) });
    } catch (err) {
      request.log.warn({ err, id, n }, 'Failed to read subtitle timeline file');
      return reply.code(200).send({ timeline: null });
    }
  });

  // PUT /api/pdfs/:id/pages/:n/script
  app.put('/api/pdfs/:id/pages/:n/script', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const bodyParsed = z.object({ script: z.string().max(4096) }).safeParse(request.body ?? {});
    if (!bodyParsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', bodyParsed.error.issues[0]?.message ?? 'Invalid body'));
    }
    const script = bodyParsed.data.script;
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的逐字稿'));
    }
    const pageRow = db
      .prepare(`SELECT script_path, page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { script_path: string | null; page_uid: string } | undefined;
    if (!pageRow) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }
    let scriptPath = pageRow.script_path;
    if (!scriptPath) {
      // Create script file path using page_uid if not yet assigned.
      scriptPath = `pages/${pageRow.page_uid}.script.txt`;
    }
    let abs: string;
    try {
      abs = safeJoinPdfPath(id, scriptPath);
    } catch (err) {
      request.log.warn({ err, id, n }, 'Path traversal blocked');
      return reply.code(400).send(errorResponse('INVALID_PATH', 'Invalid stored path'));
    }
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, script, 'utf8');
    const now = nowIso();
    db.prepare(`UPDATE pages SET script_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(scriptPath, now, id, n);
    db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);
    try {
      const meta = await readMetadata(id);
      if (meta) {
        meta.updated_at = now;
        await writeMetadata(id, meta);
      }
    } catch { /* non-fatal */ }
    return reply.code(200).send({ id, page_number: n, script });
  });

  // GET /api/pdfs/:id/pages/:n/audio (supports HTTP Range for <audio> seeking)
  app.get('/api/pdfs/:id/pages/:n/audio', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的語音'));
    }
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
    if (!fs.existsSync(abs)) {
      return reply.code(404).send(errorResponse('PAGE_AUDIO_NOT_FOUND', 'Page audio file missing'));
    }
    return sendAudioFile(request, reply, abs);
  });

  // GET /api/pdfs/:id/source-audio (supports HTTP Range for <audio> seeking)
  // Serves the audio downloaded for the YouTube STT fallback (see
  // pdf_sources.source_kind = 'youtube_audio').
  app.get('/api/pdfs/:id/source-audio', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsed.data;
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的來源音訊'));
    }
    const abs = youtubeSourceAudioPath(id);
    if (!fs.existsSync(abs)) {
      return reply.code(404).send(errorResponse('SOURCE_AUDIO_NOT_FOUND', 'Source audio not found'));
    }
    return sendAudioFile(request, reply, abs);
  });

  app.get('/api/pdfs/:id/pages/:n/generation-prompts', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!shareAccessForPdf(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的生成提示詞紀錄'));
    }
    const prompts = getPageGenerationPrompts(id, n);
    return reply.code(200).send(prompts);
  });

  // PATCH /api/pdfs/:id/tts-settings
  app.patch('/api/pdfs/:id/tts-settings', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const body = z.object({
      tts_voice: z.string().trim().min(1, '不支援的 tts_voice'),
      tts_speed: z.number().min(0.25, 'tts_speed 過小').max(4, 'tts_speed 過大'),
    }).safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id } = parsed.data;
    const row = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
    const now = nowIso();
    db.prepare(`UPDATE pdfs SET tts_voice = ?, tts_speed = ?, updated_at = ? WHERE id = ?`).run(
      body.data.tts_voice, body.data.tts_speed, now, id,
    );
    return reply.send({ id, tts_voice: body.data.tts_voice, tts_speed: body.data.tts_speed, updated_at: now });
  });

  // PATCH /api/pdfs/:id/script-settings
  app.patch('/api/pdfs/:id/script-settings', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const body = z.object({
      script_max_chars_per_page: z.number().int().min(80).max(2000).nullable(),
      host_mode: z.enum(['solo', 'dual']).optional(),
    }).safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id } = parsed.data;
    const row = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
    const now = nowIso();
    if (body.data.host_mode) {
      db.prepare(`UPDATE pdfs SET script_max_chars_per_page = ?, host_mode = ?, updated_at = ? WHERE id = ?`).run(
        body.data.script_max_chars_per_page, body.data.host_mode, now, id,
      );
    } else {
      db.prepare(`UPDATE pdfs SET script_max_chars_per_page = ?, updated_at = ? WHERE id = ?`).run(
        body.data.script_max_chars_per_page, now, id,
      );
    }
    return reply.send({
      id,
      script_max_chars_per_page: body.data.script_max_chars_per_page,
      ...(body.data.host_mode ? { host_mode: body.data.host_mode } : {}),
      updated_at: now,
    });
  });
}
