import type { FastifyInstance } from 'fastify';
import { ShareTokenParamSchema, getShareToken, hasShareAccess } from './share';
import { getPdfPermissionRow, canReadPdf, canEditPdf, canDestructivelyEditPdf } from './permissions';
import { toFile } from 'openai';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import sharp from 'sharp';
import { db, savePageGenerationPrompt } from '../../db';
import { config } from '../../config';
import { sessionSub } from '../auth';
import type { PageRow, PdfRow } from '../../types';
import { callChatJSON } from '../../services/openai';
import { getOpenAIClient } from '../../services/openai';
import { getRuntimeAiSettings } from '../../services/aiSettings';
import { buildImagePrompt, IMAGE_PROMPT_TEMPLATES } from '../../services/imagePromptTemplates';
import { buildFigureReferenceNotes, getFigureReferencesForPage, loadFigureReferenceFiles, loadFigureSelection } from '../../services/pdfFigures';
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
  shiftChildPageNumbers,
} from './shared';
import {
  coverImagePath,
  pageImagePath,
  pageThumbnailPath,
  pageScriptPath,
  pageTextPath,
  pageAudioPath,
  readMetadata,
  writeMetadata,
  pdfDir,
  sourceTextPath,
} from '../../services/storage';
import { generateCoverThumbnail, generatePageThumbnail } from '../../services/thumbnails';
import { commitPresentationFile } from '../../services/presentationGit';

const RewriteScriptResponseSchema = z.object({
  script: z.string().min(1).max(4096),
});

/** Mirrors regenerate.ts's imageTimeoutMs selection so every images.generate/edit call site uses the same budget instead of falling back to the client's longer global default. */
function imageEditTimeoutMs(): number {
  const quality = config.openaiImageQuality;
  return quality === 'high' || quality === 'medium' ? config.openaiImageTimeoutMsHighQuality : config.openaiImageTimeoutMs;
}

// Stricter variant for this file's destructive/irreversible routes (deleting a page outright,
// wiping a page's chat history). Reuses canEditPdf()'s owner/public_editable logic but additionally
// requires an authenticated session before the public_editable fallback applies, so a fully
// anonymous request (no session cookie, no share token) can never destroy data just because the
// presentation's visibility happens to be public_editable. All other (reversible) content-editing
// routes in this file keep using canEditPdf() unchanged. Mirrors delete.ts's canEditPdf() fix.
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
        isDual ? 'backend/prompts/generate-script-openai-dual.md' : 'backend/prompts/generate-script-openai.md',
        isDual
          ? `你是一位雙人 Podcast 節目企劃與逐字稿編輯。你的任務：生成繁體中文雙人對談逐字稿（目標約 ${params.targetChars} 字，必須控制在 ${charBounds.min}～${charBounds.max} 字之間），由 Speaker 1 與 Speaker 2 輪流對話。請回傳 JSON：{"script":"..."}`
          : `你是一位專業的中文簡報講師與旁白配音員。你的任務：生成繁體中文逐字稿（目標約 ${params.targetChars} 字，必須控制在 ${charBounds.min}～${charBounds.max} 字之間）。請回傳 JSON：{"script":"..."}`,
      ),
      { target_chars: String(params.targetChars), min_chars: String(charBounds.min), max_chars: String(charBounds.max) },
    ),
  ];
  if (isDual) {
    const speaker1 = runtime.openaiTtsSpeaker1?.trim();
    const speaker2 = runtime.openaiTtsSpeaker2?.trim();
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

const AskPageBodySchema = z.object({
  question: z.string().trim().min(1, '問題不可為空').max(500, '問題不可超過 500 字'),
  // Prior turns of the same conversation, oldest first (multi-turn follow-ups).
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .max(20)
    .optional(),
});

const AskPageResponseSchema = z.object({
  answer: z.string().min(1),
});

// Budget for the full-deck corpus sent to the AI tutor, keeping prompts bounded
// while still covering the whole presentation.
const ASK_DECK_CORPUS_MAX_CHARS = 14000;
// Budget for the original extracted source text (source.txt) attached to the
// AI tutor prompt, so it can answer from the full document even when a detail
// only exists in the source and not in any page's slide text or script.
const ASK_SOURCE_TEXT_MAX_CHARS = 12000;

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
    if (!canEditPdf(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
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
    const pageUid = nanoid(10);
    const tx = db.transaction(() => {
      // Defer FK checks to commit: we renumber pages and their child rows
      // (page_polls) in separate statements, which would otherwise transiently
      // orphan child rows mid-transaction and trip foreign_keys=ON.
      db.pragma('defer_foreign_keys = ON');
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
        `INSERT INTO pages (pdf_id, page_number, page_uid, image_path, text_path, script_path, audio_path, audio_duration_seconds, status, error_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'audio_ready', NULL, ?, ?)`,
      ).run(
        id,
        inserted,
        pageUid,
        `pages/${pageUid}.jpg`,
        `pages/${pageUid}.text.txt`,
        `pages/${pageUid}.script.txt`,
        `pages/${pageUid}.m4a`,
        now,
        now,
      );
      db.prepare(`UPDATE pdfs SET page_count = ?, updated_at = ? WHERE id = ?`).run(oldCount + 1, now, id);
    });

    try {
      tx();
      await sharp({
        create: {
          width: 1920,
          height: 1080,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(pageImagePath(id, pageUid));
      await generatePageThumbnail(id, pageUid, pageImagePath(id, pageUid));
      await fs.promises.writeFile(pageTextPath(id, pageUid), '', 'utf8');
      await fs.promises.writeFile(pageScriptPath(id, pageUid), '', 'utf8');
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
      .prepare(`SELECT page_count, user_prompt, script_max_chars_per_page, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(id) as
      | { page_count: number | null; user_prompt: string | null; script_max_chars_per_page: number | null; owner_sub: string | null; visibility: PdfRow['visibility'] }
      | undefined;
    if (!pdfRow?.page_count) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
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
    const tx = db.transaction(() => {
      // Defer FK checks to commit so renumbering pages and their child rows in
      // separate statements doesn't transiently orphan child rows.
      db.pragma('defer_foreign_keys = ON');
      // Step 1: shift all pages (and child tables) to temp range to avoid pk collisions
      db.prepare(`UPDATE pages SET page_number = page_number + 100000 WHERE pdf_id = ?`).run(id);
      shiftChildPageNumbers(id, 100000, 'all');
      // Step 2: move each page (and its child rows) to the final position
      // (file paths are keyed by the page's stable page_uid, not its number,
      // so this is a pure DB reorder — no artifact files need to move)
      for (let i = 0; i < order.length; i++) {
        const src = order[i];
        if (src == null) continue;
        const dst = i + 1;
        db.prepare(`UPDATE pages SET page_number = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(
          dst,
          now,
          id,
          src + 100000,
        );
        // Move the page's interactive/annotation content in lockstep (polls,
        // comments, drawings) so it stays attached to the same page content.
        for (const table of ['page_polls', 'page_comments', 'page_drawings']) {
          db.prepare(`UPDATE ${table} SET page_number = ? WHERE pdf_id = ? AND page_number = ?`).run(
            dst,
            id,
            src + 100000,
          );
        }
      }
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);
    });

    try {
      tx();
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
    if (!canDestructivelyEditPdf(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
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
      .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { page_number: number; page_uid: string } | undefined;
    if (!pageRow) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    const now = nowIso();
    const newCount = oldCount - 1;
    const deletedUid = pageRow.page_uid;
    const filesToDelete = [
      pageImagePath(id, deletedUid),
      pageThumbnailPath(id, deletedUid),
      pageTextPath(id, deletedUid),
      pageScriptPath(id, deletedUid),
      pageAudioPath(id, deletedUid),
    ];

    const tx = db.transaction(() => {
      // Defer FK checks to commit: pages and their child rows (page_polls) are
      // renumbered in separate statements; without this the intermediate state
      // would orphan child rows and trip foreign_keys=ON (deleting a page that
      // has polls on later pages used to fail with a FOREIGN KEY error).
      db.pragma('defer_foreign_keys = ON');
      cancelRunningPageArtifactsForDeletedPage(id, n, now);
      db.prepare(`DELETE FROM pages WHERE pdf_id = ? AND page_number = ?`).run(id, n);
      // page_polls cascade-deletes via its FK to pages; page_comments and
      // page_drawings only reference pdfs, so remove the deleted page's rows
      // explicitly (otherwise they'd survive and reattach to the next page).
      db.prepare(`DELETE FROM page_comments WHERE pdf_id = ? AND page_number = ?`).run(id, n);
      db.prepare(`DELETE FROM page_drawings WHERE pdf_id = ? AND page_number = ?`).run(id, n);
      // Compact the trailing pages (and their child rows) down by one. A direct
      // `page_number - 1` can transiently violate the UNIQUE(pdf_id, page_number)
      // index because SQLite applies the bulk UPDATE row by row in an unspecified
      // order (rowids and page_numbers diverge after earlier inserts/deletes).
      // Shift the affected pages out of range first, then back at -1 net — the
      // same offset trick the insert path uses — keeping child rows in lockstep.
      db.prepare(
        `UPDATE pages
            SET page_number = page_number + 100000
          WHERE pdf_id = ? AND page_number > ?`,
      ).run(id, n);
      shiftChildPageNumbers(id, 100000, { gt: n });
      db.prepare(
        `UPDATE pages
            SET page_number = page_number - 100001,
                updated_at = ?
          WHERE pdf_id = ? AND page_number > ?`,
      ).run(now, id, n + 100000);
      shiftChildPageNumbers(id, -100001, { gt: n + 100000 });
      db.prepare(`UPDATE pdfs SET page_count = ?, updated_at = ? WHERE id = ?`).run(newCount, now, id);
    });

    try {
      tx();
      await Promise.all(filesToDelete.map((file) => fs.promises.rm(file, { force: true })));

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
      .prepare(`SELECT pdf_id, page_number, page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { pdf_id: string; page_number: number; page_uid: string } | undefined;
    if (!pageRow) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    const row = db.prepare(`SELECT page_count, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | { page_count: number | null; owner_sub: string | null; visibility: PdfRow['visibility'] }
      | undefined;
    if (!row?.page_count) return reply.code(409).send(errorResponse('INVALID_STATE', 'PDF page_count not ready'));
    if (!canEditPdf(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }

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

    const outPath = pageImagePath(id, pageRow.page_uid);
    await sharp(imageBuffer)
      .resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(outPath);
    await generatePageThumbnail(id, pageRow.page_uid, outPath);
    if (n === 1) {
      const coverPath = coverImagePath(id);
      await fs.promises.copyFile(outPath, coverPath);
      await generateCoverThumbnail(id, coverPath);
    }

    const relImagePath = path.posix.join('pages', `${pageRow.page_uid}.jpg`);
    void commitPresentationFile(id, relImagePath, `image: replace page ${n} (user upload)`);
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
      .prepare(`SELECT page_count, user_prompt, script_max_chars_per_page, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(id) as
      | { page_count: number | null; user_prompt: string | null; script_max_chars_per_page: number | null; owner_sub: string | null; visibility: PdfRow['visibility'] }
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
    if (!pdfRow.page_count || n > pdfRow.page_count) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }
    const pageRow = db
      .prepare(`SELECT image_path, text_path, script_path, page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { image_path: string | null; text_path: string | null; script_path: string | null; page_uid: string } | undefined;
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
        : pageImagePath(id, pageRow.page_uid);
      const currentImageBuffer = await fs.promises.readFile(currentImagePath);
      const currentImageForEdit = await toFile(currentImageBuffer, `page-${n}.jpg`, { type: 'image/jpeg' });

      const figureExcludeIds = new Set(loadFigureSelection(id, pageRow.page_uid).excluded);
      const rawFigureRefs = getFigureReferencesForPage(id, n, undefined, figureExcludeIds);
      const { figures: figureRefs, files: figureRefFiles } = await loadFigureReferenceFiles(id, rawFigureRefs);
      const editImage: Parameters<typeof client.images.edit>[0]['image'] =
        figureRefFiles.length > 0 ? [currentImageForEdit, ...figureRefFiles] : currentImageForEdit;

      const basePrompt = buildImagePrompt({
        stylePrompt: IMAGE_PROMPT_TEMPLATES[0]?.prompt_en,
        pageText,
        pageScript,
        figureNotes: buildFigureReferenceNotes(figureRefs),
        userAdjustmentPrompt: [
          historyPrompt ? `Conversation history for iterative image editing:\n${historyPrompt}` : '',
          `Current user adjustment request:\n${prompt}`,
        ].filter(Boolean).join('\n\n'),
      });

      const editPrompt = renderPromptTemplate(
        loadPromptTemplate('backend/prompts/edit-slide-image.md', EDIT_SLIDE_IMAGE_PROMPT_FALLBACK),
        { base_prompt: basePrompt },
      );

      const edited = await client.images.edit(
        {
          model: config.openaiImageModel,
          image: editImage,
          prompt: editPrompt,
          size: '1536x1024',
        },
        { timeout: imageEditTimeoutMs() },
      );
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

  // POST /api/pdfs/:id/pages/:n/inpaint-image
  // multipart fields: mask (PNG, optional), reference (file, optional), prompt (text)
  // Reads the current slide image from disk as the source; the mask marks the region to
  // modify (transparent = edit, white = keep); the optional reference image is passed as
  // an additional context image to gpt-image-2.
  app.post('/api/pdfs/:id/pages/:n/inpaint-image', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    if (!request.isMultipart()) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    }
    const { id, n } = parsed.data;

    const pdfRow = db
      .prepare(`SELECT page_count, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null; owner_sub: string | null; visibility: PdfRow['visibility'] } | undefined;
    if (!pdfRow?.page_count) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }

    const pageRow = db
      .prepare(`SELECT image_path, page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { image_path: string | null; page_uid: string } | undefined;
    if (!pageRow) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    let maskBuffer: Buffer | null = null;
    let referenceBuffer: Buffer | null = null;
    let prompt = '';
    const parts = request.parts({ limits: { files: 2 } });
    for await (const part of parts) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (part.fieldname === 'mask') maskBuffer = buf;
        else if (part.fieldname === 'reference') referenceBuffer = buf;
      } else {
        if (part.fieldname === 'prompt') prompt = String(part.value ?? '');
      }
    }
    if (!prompt.trim()) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Missing prompt field'));
    }

    try {
      const client = getOpenAIClient();

      // Read current slide image from disk and resize to 1536x1024 to match mask dimensions.
      // GPT-Image-2 requires the mask to be the same size as the input image.
      const currentImagePath = pageRow.image_path
        ? safeJoinPdfPath(id, pageRow.image_path)
        : pageImagePath(id, pageRow.page_uid);
      const rawSlideBuffer = await fs.promises.readFile(currentImagePath);
      const slideResizedBuffer = await sharp(rawSlideBuffer)
        .resize(1536, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
        .png()
        .toBuffer();
      const maskFile = (maskBuffer && maskBuffer.length)
        ? await toFile(maskBuffer, 'mask.png', { type: 'image/png' })
        : undefined;

      // When a mask is present but no reference image is provided, pass the current slide
      // as both the source image and the reference so the model has content context for the
      // masked region instead of filling it with black.
      const slideFile = await toFile(slideResizedBuffer, `slide-${n}.png`, { type: 'image/png' });
      const images: Parameters<typeof client.images.edit>[0]['image'] = referenceBuffer?.length
        ? [slideFile, await toFile(referenceBuffer, 'reference.png', { type: 'image/png' })]
        : maskFile
          ? [slideFile, await toFile(slideResizedBuffer, `slide-ref-${n}.png`, { type: 'image/png' })]
          : slideFile;

      const edited = await client.images.edit(
        {
          model: 'gpt-image-2',
          image: images,
          prompt: prompt.trim(),
          size: '1536x1024',
          ...(maskFile ? { mask: maskFile } : {}),
        },
        { timeout: imageEditTimeoutMs() },
      );
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
    const pdfRow = db.prepare(`SELECT owner_sub, visibility, page_count FROM pdfs WHERE id = ?`).get(id) as
      | { owner_sub: string | null; visibility: PdfRow['visibility']; page_count: number | null }
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!hasShareAccess(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的候選圖片'));
    }
    if (!pdfRow.page_count || n > pdfRow.page_count) {
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
      .prepare(`SELECT page_count, user_prompt, script_max_chars_per_page, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(id) as
      | { page_count: number | null; user_prompt: string | null; script_max_chars_per_page: number | null; owner_sub: string | null; visibility: PdfRow['visibility'] }
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
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
      void commitPresentationFile(id, pageRow.script_path, `script: rewrite page ${n} via chat`);
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
      .prepare(`SELECT page_count, tts_voice, tts_speed, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(id) as
      | { page_count: number | null; tts_voice: string | null; tts_speed: number | null; owner_sub: string | null; visibility: PdfRow['visibility'] }
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
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
      void commitPresentationFile(id, pageRow.script_path, `script: update page ${n} for audio regeneration`);
      const result = await synthesizeAudio({
        pdfId: id,
        pageCount: pdfRow.page_count,
        pages: [{ pageNumber: n, script }],
        voice: pdfRow.tts_voice ?? undefined,
        speed: pdfRow.tts_speed ?? undefined,
      });
      const audio = result.pages[0];
      if (!audio) throw new Error('Audio synthesis returned no page result');

      if (audio.skipped) {
        const reason = audio.error ?? '語音生成失敗';
        request.log.error({ pdfId: id, pageNumber: n, error: reason }, 'Audio synthesis failed for page');
        const now = nowIso();
        db.prepare(
          `UPDATE pages
              SET script_path = ?, status = 'failed', error_message = ?, updated_at = ?
            WHERE pdf_id = ? AND page_number = ?`,
        ).run(pageRow.script_path, reason, now, id, n);
        db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);
        try {
          const meta = await readMetadata(id);
          if (meta) {
            const page = meta.pages.find((p) => p.page_number === n);
            if (page) {
              page.script = pageRow.script_path;
              page.status = 'failed';
            }
            meta.updated_at = now;
            await writeMetadata(id, meta);
          }
        } catch {
          // non-fatal
        }
        return reply.code(502).send(errorResponse('TTS_FAILED', reason));
      }

      const relAudioPath = path.relative(pdfDir(id), audio.audioPath);
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
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!hasShareAccess(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的聊天紀錄'));
    }
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
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canDestructivelyEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
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
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
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
      // Re-read chat_history_json right before writing back, instead of appending onto the
      // `requestHistory` snapshot captured before the (potentially slow) callChatJSON await
      // above. If two requests for the same page run concurrently (e.g. two browser tabs, or a
      // classroom sync session where multiple viewers can each ask their own question), both
      // start from the same pre-await snapshot; without this re-read, whichever request's
      // UPDATE lands last would blindly overwrite the row using its own stale snapshot,
      // silently discarding the other request's question+answer that was already committed by
      // then. Appending onto a freshly read row instead preserves both requests' messages
      // regardless of which LLM call finishes first.
      const latestPageRow = db
        .prepare(`SELECT chat_history_json FROM pages WHERE pdf_id = ? AND page_number = ?`)
        .get(id, n) as { chat_history_json: string | null } | undefined;
      const latestHistory = latestPageRow ? parseChatHistory(latestPageRow.chat_history_json) : requestHistory;
      const nextHistory = [...latestHistory, { role: 'user' as const, content: parsedBody.data.question }, { role: 'assistant' as const, content: answer }].slice(-20);
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

  // AI 導師：針對目前頁面的單次問答，回答中標示引用來源。
  // 需登入（sub !== null）；public 或有效分享連結亦可存取。匿名分享連結禁止。
  app.post('/api/pdfs/:id/pages/:n/ask', async (request, reply) => {
    const parsedParams = PageParamSchema.safeParse(request.params);
    const parsedBody = AskPageBodySchema.safeParse(request.body ?? {});
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error?.issues[0]?.message ?? 'Invalid request'));
    }
    const { id, n } = parsedParams.data;
    const sub = sessionSub(request);
    if (!sub) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '請先登入才能使用 AI 導師問答'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canReadPdf(sub, pdfRow) && !hasShareAccess(request, id)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限查閱此簡報'));
    }
    const pageRow = db
      .prepare(`SELECT text_path, script_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { text_path: string | null; script_path: string | null } | undefined;
    if (!pageRow) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    const pdfTitleRow = db.prepare(`SELECT title FROM pdfs WHERE id = ?`).get(id) as { title?: string | null } | undefined;
    try {
      // Build a corpus from EVERY page (text + script), so the tutor can answer
      // using the whole presentation, not just the current page.
      const allPages = db
        .prepare(`SELECT page_number, text_path, script_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
        .all(id) as Array<{ page_number: number; text_path: string | null; script_path: string | null }>;
      const sections: string[] = [];
      for (const p of allPages) {
        const text = p.text_path ? await fs.promises.readFile(safeJoinPdfPath(id, p.text_path), 'utf8').catch(() => '') : '';
        const script = p.script_path ? await fs.promises.readFile(safeJoinPdfPath(id, p.script_path), 'utf8').catch(() => '') : '';
        if (!text.trim() && !script.trim()) continue;
        sections.push(
          [`# 第 ${p.page_number} 頁${p.page_number === n ? '（學生目前所在頁）' : ''}`,
            text.trim() ? `頁面文字：${text.trim()}` : '',
            script.trim() ? `逐字稿：${script.trim()}` : '',
          ].filter(Boolean).join('\n'),
        );
      }
      let corpus = sections.join('\n\n');
      if (corpus.length > ASK_DECK_CORPUS_MAX_CHARS) corpus = corpus.slice(0, ASK_DECK_CORPUS_MAX_CHARS) + '\n……（內容過長，後略）……';

      // Also attach the original extracted source text (source.txt) when present,
      // so the tutor can answer from the full document even when an answer only
      // exists in the source and not in any page's slide text or script.
      let sourceText = await fs.promises.readFile(sourceTextPath(id), 'utf8').catch(() => '');
      sourceText = sourceText.trim();
      if (sourceText.length > ASK_SOURCE_TEXT_MAX_CHARS) {
        sourceText = sourceText.slice(0, ASK_SOURCE_TEXT_MAX_CHARS) + '\n……（原文過長，後略）……';
      }

      const history = (parsedBody.data.history ?? []).map((m) => ({ role: m.role, content: m.content }));
      const result = await callChatJSON({
        label: `ask-page ${id}/${n}`,
        schema: AskPageResponseSchema,
        maxTokens: 4000,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: '你是繁體中文課堂 AI 導師。請只輸出 JSON：{"answer":"..."}。你會獲得整份簡報所有頁面的頁面文字與逐字稿（每頁以「# 第 N 頁」標示，其中一頁標為「學生目前所在頁」），以及（若有）這份教材的原始來源全文。請綜合全份內容詳細回答學生問題，必要時可跨頁說明；當答案只出現在原始來源全文、而不在投影片文字或逐字稿時，也要依原始來源全文作答。回答請完整、清楚、有條理，盡量解釋透徹，不要刻意精簡；可使用條列。【引用規則（務必遵守）】只要你的回答用到「學生目前所在頁」以外其他頁面的資訊，就必須在該處主動以括號標示來源頁碼，例如「（第 3 頁）」或「（第 3 頁逐字稿）」，不可省略；引用原始來源全文時標示「（原始來源）」；引用學生目前所在頁的內容則可不標示頁碼。若所有提供的內容都沒有相關資訊，請誠實說明。',
          },
          {
            role: 'user',
            content: [
              `簡報標題：${pdfTitleRow?.title?.trim() || '（未命名）'}`,
              `學生目前頁碼：${n}`,
              `以下為整份簡報內容（逐頁的投影片文字與逐字稿）：`,
              '-----------------',
              corpus || '（無可用內容）',
              '-----------------',
              ...(sourceText
                ? [
                    '以下為這份教材的原始來源全文（可能包含未寫進投影片或逐字稿的細節）：',
                    '=================',
                    sourceText,
                    '=================',
                  ]
                : []),
            ].join('\n'),
          },
          ...history,
          { role: 'user', content: parsedBody.data.question },
        ],
      });
      return reply.code(200).send({ answer: result.data.answer.trim() });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to answer page ask question');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to answer question'));
    }
  });
}
