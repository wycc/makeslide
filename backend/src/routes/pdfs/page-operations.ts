import type { FastifyInstance } from 'fastify';
import { toFile } from 'openai';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import sharp from 'sharp';
import { db, savePageGenerationPrompt } from '../../db';
import { config } from '../../config';
import type { PageRow, PdfRow } from '../../types';
import { callChatJSON } from '../../services/openai';
import { getOpenAIClient } from '../../services/openai';
import { getRuntimeAiSettings } from '../../services/aiSettings';
import { buildImagePrompt, IMAGE_PROMPT_TEMPLATES } from '../../services/imagePromptTemplates';
import { loadPromptTemplate, renderPromptTemplate } from '../../services/promptTemplates';
import { safeJoinPdfPath } from '../../services/storage';
import { synthesizeAudio } from '../../worker/steps/synthesizeAudio';
import { scriptCharBounds, getPdfHostMode } from '../../worker/steps/generateScript';
import {
  AddPageBodySchema,
  IdParamSchema,
  MovePageBodySchema,
  PageParamSchema,
  RegenerateAudioBodySchema,
  RegenerateImageBodySchema,
  RewriteScriptBodySchema,
  errorResponse,
  nowIso,
  rewritePagePathsToMatchNumber,
  shiftChildPageNumbers,
} from './shared';
import {
  coverImagePath,
  pageImagePath,
  pageThumbnailPath,
  pageScriptPath,
  pageTextPath,
  readMetadata,
  renumberPageArtifacts,
  writeMetadata,
} from '../../services/storage';
import { generateCoverThumbnail, generatePageThumbnail } from '../../services/thumbnails';

const RewriteScriptResponseSchema = z.object({
  script: z.string().min(1).max(4096),
});

const EDIT_SLIDE_IMAGE_PROMPT_FALLBACK = [
  'You are editing an existing presentation slide image provided as the input image.',
  'Use the uploaded image as the strict visual source of truth.',
  'Preserve the original slide layout, composition, colors, typography style, relative object positions, diagrams, icons, and readable text unless the user explicitly asks to change those specific elements.',
  'Only make the minimal edits required by the user adjustment prompt. Do not redesign the slide, do not invent unrelated visual elements, and do not change the overall style beyond the requested modification.',
  'If the request is ambiguous, prefer conservative local edits and keep the original image as unchanged as possible.',
  '',
  '{{base_prompt}}',
].join('\n');

const IMAGE_CANDIDATE_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

const MAX_USER_PROMPT_CHARS_IN_REWRITE_SYSTEM = 1200;

function cancelRunningPageArtifactsForDeletedPage(pdfId: string, pageNumber: number, now: string): void {
  db.prepare(
    `UPDATE page_artifact_timings
        SET status = 'canceled',
            ended_at = COALESCE(ended_at, ?),
            duration_ms = CASE
              WHEN started_at IS NOT NULL AND ended_at IS NULL THEN MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER))
              ELSE duration_ms
            END,
            sla_status = 'unknown',
            error_code = 'PAGE_DELETED',
            error_message = 'Page was deleted while artifact generation was still running',
            updated_at = ?
      WHERE pdf_id = ?
        AND page_number = ?
        AND status = 'running'`,
  ).run(now, now, now, pdfId, pageNumber);
}

function sanitiseRewriteUserPrompt(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.length > MAX_USER_PROMPT_CHARS_IN_REWRITE_SYSTEM
    ? trimmed.slice(0, MAX_USER_PROMPT_CHARS_IN_REWRITE_SYSTEM) + '……（已截斷）'
    : trimmed;
}

function buildRewriteScriptSystemPrompt(params: {
  userPrompt: string | null | undefined;
  targetChars: number;
  hostMode?: 'solo' | 'dual';
}): string {
  const runtime = getRuntimeAiSettings();
  const isDual = params.hostMode === 'dual';
  const charBounds = scriptCharBounds(params.targetChars);
  const charLimitInstruction = `【字數限制】逐字稿長度必須控制在 ${charBounds.min}～${charBounds.max} 字之間（目標約 ${params.targetChars} 字）：內容多時請優先濃縮、只挑核心重點講，不可超過 ${charBounds.max} 字上限；內容少時可適度展開，但不要灌水。`;
  if (runtime.ttsProvider === 'gemini') {
    const fallback = isDual
      ? '你是一位 Podcast 逐字稿編輯助理。請輸出 JSON：{"script":"..."}'
      : '你是一位繁體中文簡報旁白編輯。請輸出 JSON：{"script":"..."}';
    const template = loadPromptTemplate(
      isDual ? 'backend/prompts/generate-script-gemini.md' : 'backend/prompts/generate-script-gemini-solo.md',
      fallback,
    );
    const base = [template, '', charLimitInstruction];
    if (isDual) {
      const speaker1 = runtime.geminiTtsSpeaker1?.trim();
      const speaker2 = runtime.geminiTtsSpeaker2?.trim();
      if (speaker1 || speaker2) {
        const speakerBlockTpl = loadPromptTemplate(
          'backend/prompts/partials/gemini-speaker-persona-block.md',
          '【雙主持人角色人設（優先遵守）】\n{{speaker1_line}}\n{{speaker2_line}}',
        );
        base.push('');
        base.push(
          renderPromptTemplate(speakerBlockTpl, {
            speaker1_line: speaker1 ? `- Speaker 1 人設：${speaker1}` : '',
            speaker2_line: speaker2 ? `- Speaker 2 人設：${speaker2}` : '',
          }),
        );
      }
    }
    const sanitized = sanitiseRewriteUserPrompt(params.userPrompt);
    if (sanitized) {
      const userBlockTpl = loadPromptTemplate(
        'backend/prompts/partials/user-style-block.md',
        '【使用者指定的風格 / 語氣 / 聽眾要求】\n{{user_prompt}}',
      );
      base.push('');
      base.push(renderPromptTemplate(userBlockTpl, { user_prompt: sanitized }));
    }
    return base.join('\n');
  }

  const base = [
    renderPromptTemplate(
      loadPromptTemplate(
        'backend/prompts/generate-script-openai.md',
        `你是一位專業的中文簡報講師與旁白配音員。你的任務：生成繁體中文逐字稿（目標約 ${params.targetChars} 字，必須控制在 ${charBounds.min}～${charBounds.max} 字之間）。請回傳 JSON：{"script":"..."}`,
      ),
      { target_chars: String(params.targetChars), min_chars: String(charBounds.min), max_chars: String(charBounds.max) },
    ),
  ];
  const sanitized = sanitiseRewriteUserPrompt(params.userPrompt);
  if (sanitized) {
    const userBlockTpl = loadPromptTemplate(
      'backend/prompts/partials/user-style-block-openai.md',
      '【使用者指定的風格 / 語氣 / 聽眾要求】（優先遵守；若與上述規則衝突時，仍須維持逐字稿結構，但語氣、人稱、情緒強度可依照此要求調整。請勿把這段內容直接複製到輸出裡。）\n{{user_prompt}}',
    );
    base.push('');
    base.push(renderPromptTemplate(userBlockTpl, { user_prompt: sanitized }));
  }
  return base.join('\n');
}

function buildRewriteScriptUserPrompt(params: {
  pageNumber: number;
  pageCount: number;
  targetChars: number;
  editPrompt: string;
  previousScript: string;
  currentScript: string;
  nextScript: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): string {
  const previousBlock = params.previousScript.trim()
    ? `【上一頁逐字稿（供銜接參考，請勿重複其句子）】\n${params.previousScript.trim()}`
    : params.pageNumber === 1
      ? '【備註】這是第一頁，請自然地作為開場引言。'
      : '【上一頁逐字稿】（無）';
  const nextBlock = params.nextScript.trim()
    ? `【下一頁逐字稿（供銜接鋪陳，請勿提前講完下一頁細節）】\n${params.nextScript.trim()}`
    : params.pageNumber === params.pageCount
      ? '【備註】這是最後一頁，請自然地作為總結 / 收尾。'
      : '【下一頁逐字稿】（無）';
  const historyBlock = params.history.length > 0
    ? `【最近對話】\n${params.history.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    : '【最近對話】（無）';

  const bounds = scriptCharBounds(params.targetChars);
  return [
    `目前頁碼：第 ${params.pageNumber} 頁 / 共 ${params.pageCount} 頁。`,
    `目標字數：約 ${params.targetChars} 字，長度必須落在 ${bounds.min}～${bounds.max} 字之間。`,
    `請在這個字數範圍內把重點講清楚；內容多時優先濃縮、挑核心重點，不可超過 ${bounds.max} 字上限，不要為了湊字數而灌水。`,
    `輸出語言：${config.openaiScriptLanguage}（繁體中文）。`,
    '',
    previousBlock,
    nextBlock,
    '',
    '【本頁目前逐字稿】',
    params.currentScript.trim(),
    '',
    `【使用者修改指示】\n${params.editPrompt}`,
    '',
    historyBlock,
    '',
    `請依照修改指示重寫「本頁目前逐字稿」，並維持與生成路徑一致的風格、語氣、格式；字數必須落在 ${bounds.min}～${bounds.max} 字之間。`,
    '上一頁與下一頁逐字稿只用來確認頁間一致性和連續性；不要把前後頁內容整段併入本頁。',
    '避免使用「這一頁／本頁／此頁／本張」等單頁指稱，改用連續敘事語氣。',
    '請以 JSON 格式回覆：{"script": "逐字稿內容..."}',
  ].join('\n');
}

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

const PageChatBodySchema = z.object({
  question: z.string().min(1, 'question 不可為空').max(4000, 'question 不可超過 4000 字'),
  history: z.array(ChatMessageSchema).max(20).optional().default([]),
});

const PageChatResponseSchema = z.object({
  answer: z.string().min(1).max(4000),
});

function parseChatHistory(json: string | null): Array<z.infer<typeof ChatMessageSchema>> {
  if (!json) return [];
  try {
    const parsed = z.array(ChatMessageSchema).safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

async function loadPageImageAsDataUrl(absPath: string): Promise<string | null> {
  try {
    const buf = await sharp(absPath)
      .resize({ width: config.openaiScriptImageMaxWidth, withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function registerPageOperationsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/:id/pages', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = AddPageBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid body'));
    }
    const { id } = parsedParams.data;
    const row = db.prepare(`SELECT * FROM pdfs WHERE id = ?`).get(id) as PdfRow | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (row.status !== 'ready' || !row.page_count || row.page_count <= 0) {
      return reply.code(409).send(errorResponse('INVALID_STATE', 'Only ready deck can add slide'));
    }
    const oldCount = row.page_count;
    const after = parsedBody.data.after_page_number;
    if (after < 0 || after > oldCount) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid after_page_number'));
    }
    const inserted = after + 1;
    const now = nowIso();
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE pages
            SET page_number = page_number + 100000
          WHERE pdf_id = ? AND page_number > ?`,
      ).run(id, after);
      shiftChildPageNumbers(id, 100000, { gt: after });
      db.prepare(
        `UPDATE pages
            SET page_number = page_number - 99999
          WHERE pdf_id = ? AND page_number > ?`,
      ).run(id, after + 100000);
      shiftChildPageNumbers(id, -99999, { gt: after + 100000 });
      db.prepare(
        `INSERT INTO pages (pdf_id, page_number, image_path, text_path, script_path, audio_path, audio_duration_seconds, status, error_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'audio_ready', NULL, ?, ?)`,
      ).run(
        id,
        inserted,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.jpg`,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.text.txt`,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.script.txt`,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.m4a`,
        now,
        now,
      );
      db.prepare(`UPDATE pdfs SET page_count = ?, updated_at = ? WHERE id = ?`).run(oldCount + 1, now, id);
      rewritePagePathsToMatchNumber(id, oldCount + 1);
    });

    try {
      tx();
      await renumberPageArtifacts(
        id,
        oldCount,
        Array.from({ length: oldCount - after }, (_, i) => ({ from: oldCount - i, to: oldCount - i + 1 })),
      );
      await sharp({
        create: {
          width: 1920,
          height: 1080,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(pageImagePath(id, inserted, oldCount + 1));
      await generatePageThumbnail(id, inserted, oldCount + 1, pageImagePath(id, inserted, oldCount + 1));
      await fs.promises.writeFile(pageTextPath(id, inserted, oldCount + 1), '', 'utf8');
      await fs.promises.writeFile(pageScriptPath(id, inserted, oldCount + 1), '', 'utf8');
      const meta = await readMetadata(id);
      if (meta) {
        meta.page_count = oldCount + 1;
        meta.updated_at = now;
        meta.pages = db
          .prepare(`SELECT page_number, image_path, text_path, script_path, audio_path, status FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
          .all(id)
          .map((p: any) => ({
            page_number: p.page_number,
            image: p.image_path,
            text: p.text_path,
            script: p.script_path,
            audio: p.audio_path,
            status: p.status,
          }));
        await writeMetadata(id, meta);
      }
      return reply.code(201).send({ id, page_number: inserted, page_count: oldCount + 1, updated_at: now });
    } catch (err) {
      request.log.error({ err, pdfId: id }, 'Failed to add page');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to add page'));
    }
  });

  app.post('/api/pdfs/:id/pages/move', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = MovePageBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const { id } = parsedParams.data;
    const { from_page_number: from, to_page_number: to } = parsedBody.data;
    const pdfRow = db
      .prepare(`SELECT page_count, user_prompt, script_max_chars_per_page FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null; user_prompt: string | null; script_max_chars_per_page: number | null } | undefined;
    if (!pdfRow?.page_count) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const pageCount = pdfRow.page_count;
    if (from < 1 || from > pageCount || to < 1 || to > pageCount) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid from_page_number or to_page_number'));
    }
    if (from === to) {
      return reply.code(200).send({ id, page_count: pageCount, updated_at: nowIso() });
    }

    const rows = db
      .prepare(`SELECT page_number FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
      .all(id) as Array<{ page_number: number }>;
    const order = rows.map((r) => r.page_number);
    if (order.length !== pageCount) {
      return reply.code(409).send(errorResponse('INVALID_STATE', 'Page list incomplete'));
    }

    const fromIdx = from - 1;
    const toIdx = to - 1;
    const [moved] = order.splice(fromIdx, 1);
    if (moved == null) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid from_page_number'));
    }
    order.splice(toIdx, 0, moved);

    const now = nowIso();
    const updates: Array<{ from: number; to: number }> = [];
    const tx = db.transaction(() => {
      // Step 1: shift all pages (and child tables) to temp range to avoid pk collisions
      db.prepare(`UPDATE pages SET page_number = page_number + 100000 WHERE pdf_id = ?`).run(id);
      shiftChildPageNumbers(id, 100000, 'all');
      // Step 2: move each page (and its child rows) to the final position
      for (let i = 0; i < order.length; i++) {
        const src = order[i];
        if (src == null) continue;
        const dst = i + 1;
        updates.push({ from: src, to: dst });
        db.prepare(`UPDATE pages SET page_number = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(
          dst,
          now,
          id,
          src + 100000,
        );
        db.prepare(`UPDATE page_polls SET page_number = ? WHERE pdf_id = ? AND page_number = ?`).run(
          dst,
          id,
          src + 100000,
        );
      }
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);
      rewritePagePathsToMatchNumber(id, pageCount);
    });

    try {
      tx();
      await renumberPageArtifacts(id, pageCount, updates);
      const meta = await readMetadata(id);
      if (meta) {
        const metaRows = db
          .prepare(`SELECT page_number, image_path, text_path, script_path, audio_path, status FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
          .all(id) as Array<{ page_number: number; image_path: string | null; text_path: string | null; script_path: string | null; audio_path: string | null; status: string }>;
        meta.pages = metaRows.map((p) => ({
          page_number: p.page_number,
          image: p.image_path,
          text: p.text_path,
          script: p.script_path,
          audio: p.audio_path,
          status: p.status as PageRow['status'],
        }));
        meta.updated_at = now;
        await writeMetadata(id, meta);
      }
    } catch (err) {
      request.log.error({ err, pdfId: id, from, to }, 'Failed to move page');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to move page'));
    }

    return reply.code(200).send({ id, page_count: pageCount, updated_at: now });
  });

  app.delete('/api/pdfs/:id/pages/:n', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }

    const { id, n } = parsed.data;
    const row = db.prepare(`SELECT * FROM pdfs WHERE id = ?`).get(id) as PdfRow | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (row.status !== 'ready' || !row.page_count || row.page_count <= 0) {
      return reply.code(409).send(errorResponse('INVALID_STATE', 'Only ready deck can delete slide'));
    }

    const oldCount = row.page_count;
    if (n < 1) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid page number'));
    }
    if (n > oldCount) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }
    if (oldCount <= 1) {
      return reply.code(409).send(errorResponse('INVALID_STATE', 'Cannot delete the last slide'));
    }

    const pageRow = db
      .prepare(`SELECT page_number FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { page_number: number } | undefined;
    if (!pageRow) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    const now = nowIso();
    const newCount = oldCount - 1;
    const updates = Array.from({ length: oldCount - n }, (_, i) => ({ from: n + i + 1, to: n + i }));
    const filesToDelete = [
      pageImagePath(id, n, oldCount),
      pageThumbnailPath(id, n, oldCount),
      pageTextPath(id, n, oldCount),
      pageScriptPath(id, n, oldCount),
      path.join(path.dirname(pageImagePath(id, n, oldCount)), `${String(n).padStart(oldCount > 999 ? 4 : 3, '0')}.png`),
      path.join(path.dirname(pageImagePath(id, n, oldCount)), `${String(n).padStart(oldCount > 999 ? 4 : 3, '0')}.m4a`),
    ];

    const tx = db.transaction(() => {
      cancelRunningPageArtifactsForDeletedPage(id, n, now);
      db.prepare(`DELETE FROM pages WHERE pdf_id = ? AND page_number = ?`).run(id, n);
      db.prepare(
        `UPDATE pages
            SET page_number = page_number - 1,
                updated_at = ?
          WHERE pdf_id = ? AND page_number > ?`,
      ).run(now, id, n);
      db.prepare(`UPDATE pdfs SET page_count = ?, updated_at = ? WHERE id = ?`).run(newCount, now, id);
      rewritePagePathsToMatchNumber(id, newCount);
    });

    try {
      tx();
      await Promise.all(filesToDelete.map((file) => fs.promises.rm(file, { force: true })));
      await renumberPageArtifacts(id, oldCount, updates);

      const meta = await readMetadata(id);
      if (meta) {
        const metaRows = db
          .prepare(`SELECT page_number, image_path, text_path, script_path, audio_path, status FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
          .all(id) as Array<{ page_number: number; image_path: string | null; text_path: string | null; script_path: string | null; audio_path: string | null; status: string }>;
        meta.page_count = newCount;
        meta.pages = metaRows.map((p) => ({
          page_number: p.page_number,
          image: p.image_path,
          text: p.text_path,
          script: p.script_path,
          audio: p.audio_path,
          status: p.status as PageRow['status'],
        }));
        meta.updated_at = now;
        await writeMetadata(id, meta);
      }

      return reply.code(200).send({ id, page_count: newCount, updated_at: now });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to delete page');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to delete page'));
    }
  });

  app.post('/api/pdfs/:id/pages/:n/replace-image', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    if (!request.isMultipart()) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    }
    const { id, n } = parsed.data;
    const pageRow = db
      .prepare(`SELECT pdf_id, page_number FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { pdf_id: string; page_number: number } | undefined;
    if (!pageRow) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    const row = db.prepare(`SELECT page_count FROM pdfs WHERE id = ?`).get(id) as { page_count: number | null } | undefined;
    if (!row?.page_count) return reply.code(409).send(errorResponse('INVALID_STATE', 'PDF page_count not ready'));

    const file = await request.file();
    if (!file) return reply.code(400).send(errorResponse('NO_FILE', 'No file field found'));
    const imageBuffer = await file.toBuffer();
    try {
      const meta = await sharp(imageBuffer).metadata();
      if (!meta.format) {
        return reply.code(400).send(errorResponse('INVALID_MIME', 'Image must be decodable'));
      }
    } catch {
      return reply.code(400).send(errorResponse('INVALID_MIME', 'Image must be decodable'));
    }

    const outPath = pageImagePath(id, n, row.page_count);
    await sharp(imageBuffer)
      .resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(outPath);
    await generatePageThumbnail(id, n, row.page_count, outPath);
    if (n === 1) {
      const coverPath = coverImagePath(id);
      await fs.promises.copyFile(outPath, coverPath);
      await generateCoverThumbnail(id, coverPath);
    }

    const relImagePath = path.posix.join('pages', `${String(n).padStart(row.page_count > 999 ? 4 : 3, '0')}.jpg`);
    const now = nowIso();
    db.prepare(`UPDATE pages SET image_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(relImagePath, now, id, n);
    db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);

    try {
      const meta = await readMetadata(id);
      if (meta) {
        const page = meta.pages.find((p) => p.page_number === n);
        if (page) page.image = relImagePath;
        meta.updated_at = now;
        await writeMetadata(id, meta);
      }
    } catch {
      // non-fatal
    }

    return reply.code(200).send({ id, page_number: n, image_url: `api/pdfs/${id}/pages/${n}/image`, updated_at: now });
  });

  app.post('/api/pdfs/:id/pages/:n/regenerate-image', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = RegenerateImageBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const prompt = parsedBody.data.prompt.trim();
    const historyPrompt = parsedBody.data.history
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const pdfRow = db
      .prepare(`SELECT page_count, user_prompt, script_max_chars_per_page FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null; user_prompt: string | null; script_max_chars_per_page: number | null } | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!pdfRow.page_count || n > pdfRow.page_count) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }
    const pageRow = db
      .prepare(`SELECT image_path, text_path, script_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { image_path: string | null; text_path: string | null; script_path: string | null } | undefined;
    if (!pageRow) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }

    try {
      const client = getOpenAIClient();
      let pageText = '';
      let pageScript = '';
      if (pageRow.text_path) {
        try {
          pageText = await fs.promises.readFile(safeJoinPdfPath(id, pageRow.text_path), 'utf8');
        } catch {
          pageText = '';
        }
      }
      if (pageRow.script_path) {
        try {
          pageScript = await fs.promises.readFile(safeJoinPdfPath(id, pageRow.script_path), 'utf8');
        } catch {
          pageScript = '';
        }
      }

      const currentImagePath = pageRow.image_path
        ? safeJoinPdfPath(id, pageRow.image_path)
        : pageImagePath(id, n, pdfRow.page_count);
      const currentImageBuffer = await fs.promises.readFile(currentImagePath);
      const currentImageForEdit = await toFile(currentImageBuffer, `page-${n}.jpg`, { type: 'image/jpeg' });

      const basePrompt = buildImagePrompt({
        stylePrompt: IMAGE_PROMPT_TEMPLATES[0]?.prompt_en,
        pageText,
        pageScript,
        userAdjustmentPrompt: [
          historyPrompt ? `Conversation history for iterative image editing:\n${historyPrompt}` : '',
          `Current user adjustment request:\n${prompt}`,
        ].filter(Boolean).join('\n\n'),
      });

      const editPrompt = renderPromptTemplate(
        loadPromptTemplate('backend/prompts/edit-slide-image.md', EDIT_SLIDE_IMAGE_PROMPT_FALLBACK),
        { base_prompt: basePrompt },
      );

      const edited = await client.images.edit({
        model: config.openaiImageModel,
        image: currentImageForEdit,
        prompt: editPrompt,
        size: '1536x1024',
      });
      const b64 = edited.data?.[0]?.b64_json;
      if (!b64) throw new Error('OpenAI image edit returned empty result');
      const newBuf = Buffer.from(b64, 'base64');
      const candidateId = nanoid(10);
      const candidateRelPath = path.posix.join('pages', `${String(n).padStart(pdfRow.page_count > 999 ? 4 : 3, '0')}.candidate.${candidateId}.jpg`);
      const candidatePath = safeJoinPdfPath(id, candidateRelPath);
      await sharp(newBuf).resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(candidatePath);

      const now = nowIso();
      return reply.code(200).send({
        id,
        page_number: n,
        image_url: `api/pdfs/${id}/pages/${n}/image-candidates/${candidateId}`,
        candidate_id: candidateId,
        updated_at: now,
      });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to regenerate image by prompt');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to regenerate image'));
    }
  });

  app.post('/api/pdfs/:id/pages/:n/inpaint-image', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    if (!request.isMultipart()) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    }
    const { id, n } = parsed.data;
    const pdfRow = db.prepare(`SELECT page_count FROM pdfs WHERE id = ?`).get(id) as { page_count: number | null } | undefined;
    if (!pdfRow?.page_count) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));

    let imageBuffer: Buffer | null = null;
    let maskBuffer: Buffer | null = null;
    let prompt = '';
    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (part.fieldname === 'image') imageBuffer = buf;
        else if (part.fieldname === 'mask') maskBuffer = buf;
      } else {
        if (part.fieldname === 'prompt') prompt = String(part.value ?? '');
      }
    }
    if (!imageBuffer || !imageBuffer.length) {
      return reply.code(400).send(errorResponse('NO_FILE', 'Missing image field'));
    }
    if (!prompt.trim()) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Missing prompt field'));
    }

    try {
      const client = getOpenAIClient();
      const imageFile = await toFile(imageBuffer, 'input.png', { type: 'image/png' });
      const maskFile = (maskBuffer && maskBuffer.length)
        ? await toFile(maskBuffer, 'mask.png', { type: 'image/png' })
        : undefined;
      const edited = await client.images.edit({
        model: 'gpt-image-2',
        image: imageFile,
        prompt: prompt.trim(),
        size: '1024x1024',
        ...(maskFile ? { mask: maskFile } : {}),
      });
      const b64 = (edited as { data?: Array<{ b64_json?: string }> }).data?.[0]?.b64_json;
      if (!b64) throw new Error('OpenAI image edit returned empty result');

      const newBuf = Buffer.from(b64, 'base64');
      const candidateId = nanoid(10);
      const padLen = pdfRow.page_count > 999 ? 4 : 3;
      const candidateRelPath = path.posix.join('pages', `${String(n).padStart(padLen, '0')}.candidate.${candidateId}.jpg`);
      const candidatePath = safeJoinPdfPath(id, candidateRelPath);
      await sharp(newBuf)
        .resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(candidatePath);

      const now = nowIso();
      return reply.code(200).send({
        id,
        page_number: n,
        image_url: `api/pdfs/${id}/pages/${n}/image-candidates/${candidateId}`,
        candidate_id: candidateId,
        updated_at: now,
      });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to inpaint image');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to inpaint image'));
    }
  });

  app.get('/api/pdfs/:id/pages/:n/image-candidates/:candidateId', async (request, reply) => {
    const parsedPage = PageParamSchema.safeParse(request.params);
    const candidateId = (request.params as { candidateId?: string }).candidateId ?? '';
    if (!parsedPage.success || !IMAGE_CANDIDATE_ID_RE.test(candidateId)) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id, page number, or candidate id'));
    }

    const { id, n } = parsedPage.data;
    const pdfRow = db.prepare(`SELECT page_count FROM pdfs WHERE id = ?`).get(id) as { page_count: number | null } | undefined;
    if (!pdfRow?.page_count || n > pdfRow.page_count) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }

    const relPath = path.posix.join('pages', `${String(n).padStart(pdfRow.page_count > 999 ? 4 : 3, '0')}.candidate.${candidateId}.jpg`);
    let abs: string;
    try {
      abs = safeJoinPdfPath(id, relPath);
      await fs.promises.access(abs, fs.constants.R_OK);
    } catch {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Image candidate ${candidateId} not found`));
    }

    reply.header('content-type', 'image/jpeg');
    reply.header('cache-control', 'no-store');
    return reply.send(fs.createReadStream(abs));
  });

  app.post('/api/pdfs/:id/pages/:n/rewrite-script', async (request, reply) => {
    const parsedParams = PageParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = RewriteScriptBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const { id, n } = parsedParams.data;
    const body = parsedBody.data;
    const pdfRow = db
      .prepare(`SELECT page_count, user_prompt, script_max_chars_per_page FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null; user_prompt: string | null; script_max_chars_per_page: number | null } | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!pdfRow.page_count || n > pdfRow.page_count) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }

    const pageRow = db
      .prepare(`SELECT script_path, chat_history_json, image_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { script_path: string | null; chat_history_json: string | null; image_path: string | null } | undefined;
    if (!pageRow?.script_path) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }

    try {
      const prompt = body.prompt.trim() || '請在保留原意與適合朗讀的前提下，潤飾這頁逐字稿。';
      const currentScript = body.current_script.trim() || body.script.trim();
      const targetChars = pdfRow.script_max_chars_per_page ?? config.openaiScriptTargetChars;

      const imageDataUrl = pageRow.image_path
        ? await loadPageImageAsDataUrl(safeJoinPdfPath(id, pageRow.image_path))
        : null;

      const userText = buildRewriteScriptUserPrompt({
        pageNumber: n,
        pageCount: pdfRow.page_count,
        targetChars,
        editPrompt: prompt,
        previousScript: body.previous_script,
        currentScript,
        nextScript: body.next_script,
        history: body.history,
      });

      const userContent: ChatCompletionContentPart[] = [];
      if (imageDataUrl) {
        userContent.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } });
      }
      userContent.push({ type: 'text', text: userText });

      const result = await callChatJSON({
        label: `rewrite-script page/${id}/${n}`,
        schema: RewriteScriptResponseSchema,
        maxTokens: 2400,
        temperature: 0.5,
        messages: [
          {
            role: 'system',
            content: buildRewriteScriptSystemPrompt({
              userPrompt: pdfRow.user_prompt,
              targetChars,
              hostMode: getPdfHostMode(id),
            }),
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
      });

      const script = result.data.script.trim();
      await fs.promises.writeFile(safeJoinPdfPath(id, pageRow.script_path), script, 'utf8');
      savePageGenerationPrompt(id, n, 'script', userText, getRuntimeAiSettings().openaiLlmModel);
      const now = nowIso();
      const nextHistory = [...body.history, { role: 'user' as const, content: prompt }, { role: 'assistant' as const, content: script }].slice(-20);
      db.prepare(`UPDATE pages SET chat_history_json = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(
        JSON.stringify(nextHistory),
        now,
        id,
        n,
      );
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);

      try {
        const meta = await readMetadata(id);
        if (meta) {
          meta.updated_at = now;
          await writeMetadata(id, meta);
        }
      } catch {
        // non-fatal
      }

      return reply.code(200).send({ id, page_number: n, script });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to rewrite page script');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to rewrite script'));
    }
  });

  app.post('/api/pdfs/:id/pages/:n/regenerate-audio', async (request, reply) => {
    const parsedParams = PageParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = RegenerateAudioBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const { id, n } = parsedParams.data;
    const pdfRow = db
      .prepare(`SELECT page_count, tts_voice, tts_speed FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null; tts_voice: string | null; tts_speed: number | null } | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!pdfRow.page_count || n > pdfRow.page_count) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }

    const pageRow = db
      .prepare(`SELECT script_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { script_path: string | null } | undefined;
    if (!pageRow?.script_path) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }

    try {
      const script = parsedBody.data.script.trim();
      await fs.promises.writeFile(safeJoinPdfPath(id, pageRow.script_path), script, 'utf8');
      const result = await synthesizeAudio({
        pdfId: id,
        pageCount: pdfRow.page_count,
        pages: [{ pageNumber: n, script }],
        voice: pdfRow.tts_voice ?? undefined,
        speed: pdfRow.tts_speed ?? undefined,
      });
      const audio = result.pages[0];
      if (!audio) throw new Error('Audio synthesis returned no page result');
      const relAudioPath = path.posix.join('pages', `${String(n).padStart(pdfRow.page_count > 999 ? 4 : 3, '0')}.m4a`);
      const now = nowIso();
      db.prepare(
        `UPDATE pages
            SET script_path = ?, audio_path = ?, audio_duration_seconds = ?, status = 'audio_ready', error_message = NULL, updated_at = ?
          WHERE pdf_id = ? AND page_number = ?`,
      ).run(pageRow.script_path, relAudioPath, audio.durationSeconds, now, id, n);
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);

      try {
        const meta = await readMetadata(id);
        if (meta) {
          const page = meta.pages.find((p) => p.page_number === n);
          if (page) {
            page.script = pageRow.script_path;
            page.audio = relAudioPath;
            page.audio_duration_seconds = audio.durationSeconds;
            page.status = 'audio_ready';
          }
          meta.updated_at = now;
          await writeMetadata(id, meta);
        }
      } catch {
        // non-fatal
      }

      return reply.code(200).send({
        id,
        page_number: n,
        script_url: `api/pdfs/${id}/pages/${n}/script`,
        audio_url: `api/pdfs/${id}/pages/${n}/audio`,
        updated_at: now,
        audio_bytes: audio.bytes,
        audio_mime: 'audio/mpeg',
      });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to regenerate page audio');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to regenerate page audio'));
    }
  });

  app.get('/api/pdfs/:id/pages/:n/chat-history', async (request, reply) => {
    const parsedParams = PageParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsedParams.data;
    const pageRow = db
      .prepare(`SELECT chat_history_json FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { chat_history_json: string | null } | undefined;
    if (!pageRow) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    return reply.code(200).send({ history: parseChatHistory(pageRow.chat_history_json) });
  });

  app.delete('/api/pdfs/:id/pages/:n/chat-history', async (request, reply) => {
    const parsedParams = PageParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsedParams.data;
    const info = db
      .prepare(`UPDATE pages SET chat_history_json = NULL, updated_at = ? WHERE pdf_id = ? AND page_number = ?`)
      .run(nowIso(), id, n);
    if (info.changes === 0) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    return reply.code(204).send();
  });

  app.post('/api/pdfs/:id/pages/:n/chat', async (request, reply) => {
    const parsedParams = PageParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = PageChatBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const { id, n } = parsedParams.data;
    const pageRow = db
      .prepare(`SELECT text_path, script_path, chat_history_json FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { text_path: string | null; script_path: string | null; chat_history_json: string | null } | undefined;
    if (!pageRow) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    try {
      const pageText = pageRow.text_path ? await fs.promises.readFile(safeJoinPdfPath(id, pageRow.text_path), 'utf8').catch(() => '') : '';
      const pageScript = pageRow.script_path ? await fs.promises.readFile(safeJoinPdfPath(id, pageRow.script_path), 'utf8').catch(() => '') : '';
      const existingHistory = parseChatHistory(pageRow.chat_history_json);
      const requestHistory = parsedBody.data.history.length > 0 ? parsedBody.data.history : existingHistory;
      const result = await callChatJSON({
        label: `page-chat ${id}/${n}`,
        schema: PageChatResponseSchema,
        maxTokens: 1200,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: '你是繁體中文簡報與逐字稿助理。請只輸出 JSON：{"answer":"..."}。回答需精簡、可操作，根據頁面文字與逐字稿內容。',
          },
          {
            role: 'user',
            content: [
              `頁碼：${n}`,
              `頁面文字：${pageText.trim() || '（無）'}`,
              `頁面逐字稿：${pageScript.trim() || '（無）'}`,
              requestHistory.length > 0
                ? `最近對話：${requestHistory.map((m) => `${m.role}: ${m.content}`).join('\n')}`
                : '最近對話：（無）',
              `使用者問題：${parsedBody.data.question}`,
            ].join('\n\n'),
          },
        ],
      });
      const answer = result.data.answer.trim();
      const nextHistory = [...requestHistory, { role: 'user' as const, content: parsedBody.data.question }, { role: 'assistant' as const, content: answer }].slice(-20);
      db.prepare(`UPDATE pages SET chat_history_json = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(
        JSON.stringify(nextHistory),
        nowIso(),
        id,
        n,
      );
      return reply.code(200).send({ answer });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to chat with page context');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to chat with page context'));
    }
  });
}
