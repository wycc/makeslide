import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db';
import { config } from '../config';
import {
  coverImagePath,
  createPdfDir,
  pageAudioPath,
  pageImagePath,
  pageScriptPath,
  pageTextPath,
  readMetadata,
  renumberPageArtifacts,
  removePdfDir,
  safeJoinPdfPath,
  videoPath,
  writeMetadata,
  writeSourcePdf,
  writeSourceText,
} from '../services/storage';
import { getOpenAIClient } from '../services/openai';
import { enqueuePdfProcessing } from '../worker/pipeline';
import { generateVideo } from '../worker/steps/generateVideo';
import type {
  ApiError,
  PageRow,
  PdfDetail,
  PdfDetailPage,
  PdfListItem,
  PdfMetadata,
  PdfMetadataPage,
  PdfRow,
  PdfStatus,
} from '../types';

const PDF_ID_SIZE = 10;

// pdf_id: nanoid alphanumeric + _ - only; our ids are 10-chars.
// Accept a slightly wider window (8-32) for forward compat but enforce charset.
const PDF_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

const IdParamSchema = z.object({
  id: z.string().regex(PDF_ID_RE, 'Invalid pdf id'),
});

// Body for POST /api/pdfs/:id/start — optional freeform style hint from
// the user. We cap length to avoid embedding megabytes of prompt into the
// DB or the per-page LLM call.
const MAX_USER_PROMPT_CHARS = 2000;
const StartBodySchema = z.object({
  prompt: z
    .string()
    .max(MAX_USER_PROMPT_CHARS, `提示詞不可超過 ${MAX_USER_PROMPT_CHARS} 字`)
    .optional()
    .default(''),
  require_script_confirmation: z.boolean().optional().default(false),
  tts_voice: z.string().min(1).max(32).optional(),
  tts_speed: z.number().min(0.25).max(4).optional(),
  script_max_chars_per_page: z.number().int().min(80).max(2000).optional(),
});

const PageParamSchema = z.object({
  id: z.string().regex(PDF_ID_RE, 'Invalid pdf id'),
  n: z
    .string()
    .regex(/^[1-9]\d{0,4}$/, 'Invalid page number')
    .transform((v) => Number(v))
    .pipe(z.number().int().positive().max(99999)),
});

const RegenerateAudioBodySchema = z.object({
  script: z.string().min(1, 'script 不可為空').max(4096, 'script 不可超過 4096 字'),
});

const RewriteScriptBodySchema = z.object({
  prompt: z.string().min(1, 'prompt 不可為空').max(2000, 'prompt 不可超過 2000 字'),
  script: z.string().min(1, 'script 不可為空').max(4096, 'script 不可超過 4096 字'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(20)
    .optional()
    .default([]),
});

const RegenerateImageBodySchema = z.object({
  prompt: z.string().min(1, 'prompt 不可為空').max(2000, 'prompt 不可超過 2000 字'),
});

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

const ChatHistorySchema = z.array(ChatMessageSchema);

const PageChatBodySchema = z.object({
  question: z.string().min(1, 'question 不可為空').max(4000, 'question 不可超過 4000 字'),
  history: z.array(ChatMessageSchema).max(20).optional().default([]),
});

const AddPageBodySchema = z.object({
  after_page_number: z.number().int().min(0).optional().default(0),
});

function errorResponse(code: string, message: string): ApiError {
  return { error: { code, message } };
}

function nowIso(): string {
  return new Date().toISOString();
}

function rewritePagePathsToMatchNumber(pdfId: string, pageCount: number): void {
  const pad = pageCount > 999 ? 4 : 3;
  db.prepare(
    `UPDATE pages
        SET image_path = 'pages/' || printf('%0${pad}d', page_number) || '.png',
            text_path = 'pages/' || printf('%0${pad}d', page_number) || '.text.txt',
            script_path = 'pages/' || printf('%0${pad}d', page_number) || '.script.txt',
            audio_path = CASE
              WHEN audio_path IS NULL THEN NULL
              ELSE 'pages/' || printf('%0${pad}d', page_number) || '.mp3'
            END
      WHERE pdf_id = ?`,
  ).run(pdfId);
}

function coverUrl(row: PdfRow): string | null {
  // Cover exists iff cover.png is on disk. For efficiency, probe once here
  // instead of stat-ing for every list row; M2 ensures cover is written as
  // soon as page 1 is rendered.
  try {
    return fs.existsSync(coverImagePath(row.id))
      ? `/api/pdfs/${row.id}/cover`
      : null;
  } catch {
    return null;
  }
}

function rowToListItem(row: PdfRow): PdfListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    page_count: row.page_count,
    progress_step: row.progress_step,
    progress_current: row.progress_current,
    progress_total: row.progress_total,
    cover_url: coverUrl(row),
    user_prompt: row.user_prompt,
    require_script_confirmation: row.require_script_confirmation === 1,
    tts_voice: row.tts_voice,
    tts_speed: row.tts_speed,
    script_max_chars_per_page: row.script_max_chars_per_page,
    created_at: row.created_at,
  };
}

function rowToDetail(row: PdfRow, pages: PageRow[]): PdfDetail {
  const detailPages: PdfDetailPage[] = pages.map((p) => ({
    page_number: p.page_number,
    image_url: p.image_path ? `/api/pdfs/${row.id}/pages/${p.page_number}/image` : null,
    text_url: p.text_path ? `/api/pdfs/${row.id}/pages/${p.page_number}/text` : null,
    script_url: p.script_path ? `/api/pdfs/${row.id}/pages/${p.page_number}/script` : null,
    audio_url: p.audio_path ? `/api/pdfs/${row.id}/pages/${p.page_number}/audio` : null,
    audio_duration_seconds: p.audio_duration_seconds,
    status: p.status,
  }));
  return {
    id: row.id,
    title: row.title,
    original_filename: row.original_filename,
    status: row.status,
    page_count: row.page_count,
    progress_step: row.progress_step,
    progress_current: row.progress_current,
    progress_total: row.progress_total,
    error_message: row.error_message,
    user_prompt: row.user_prompt,
    require_script_confirmation: row.require_script_confirmation === 1,
    tts_voice: row.tts_voice,
    tts_speed: row.tts_speed,
    script_max_chars_per_page: row.script_max_chars_per_page,
    created_at: row.created_at,
    updated_at: row.updated_at,
    video_url: fs.existsSync(videoPath(row.id)) ? `/api/pdfs/${row.id}/video` : null,
    pages: detailPages,
  };
}

function streamFile(
  reply: FastifyReply,
  filePath: string,
  contentType: string,
  cacheControl = 'private, max-age=60',
): FastifyReply {
  const stat = fs.statSync(filePath);
  reply.header('content-type', contentType);
  reply.header('content-length', String(stat.size));
  reply.header('cache-control', cacheControl);
  return reply.send(fs.createReadStream(filePath));
}

export async function pdfRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/pdfs - multipart upload
  app.post('/api/pdfs', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.isMultipart()) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    }

    const file = await request.file();
    if (!file) {
      return reply
        .code(400)
        .send(errorResponse('NO_FILE', 'No file field found in request'));
    }

    const filename = file.filename ?? 'upload.pdf';
    const mimetype = file.mimetype ?? '';
    const hasPdfExt = filename.toLowerCase().endsWith('.pdf');
    const hasPdfMime = mimetype === 'application/pdf';
    const hasTxtExt = filename.toLowerCase().endsWith('.txt');
    const hasTxtMime = mimetype === 'text/plain';
    const isPdf = hasPdfExt || hasPdfMime;
    const isTxt = hasTxtExt || hasTxtMime;
    if (!isPdf && !isTxt) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_MIME', 'File must be a PDF 或 TXT（application/pdf, text/plain）'));
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_FILES_LIMIT') {
        return reply
          .code(413)
          .send(
            errorResponse(
              'FILE_TOO_LARGE',
              `File exceeds maximum size of ${config.maxUploadMb} MB`,
            ),
          );
      }
      request.log.error({ err }, 'Failed to read upload buffer');
      return reply
        .code(500)
        .send(errorResponse('INTERNAL_ERROR', 'Failed to read upload'));
    }

    if (buffer.byteLength > config.maxUploadBytes) {
      return reply
        .code(413)
        .send(
          errorResponse(
            'FILE_TOO_LARGE',
            `File exceeds maximum size of ${config.maxUploadMb} MB`,
          ),
        );
    }

    const pdfId = nanoid(PDF_ID_SIZE);
    const createdAt = nowIso();
    const title = filename.replace(/\.pdf$/i, '').trim() || filename;
    // Do NOT start the pipeline here — wait for the user to submit a
    // style / tone prompt via POST /api/pdfs/:id/start.
    const status: PdfStatus = 'awaiting_prompt';

    try {
      createPdfDir(pdfId);
      if (isPdf) {
        await writeSourcePdf(pdfId, buffer);
      } else {
        await writeSourceText(pdfId, buffer.toString('utf8'));
      }
      const metadata: PdfMetadata = {
        id: pdfId,
        title,
        original_filename: filename,
        status,
        progress_step: null,
        progress_current: null,
        progress_total: null,
        page_count: null,
        error_message: null,
        user_prompt: null,
        require_script_confirmation: false,
        tts_voice: null,
        tts_speed: null,
        script_max_chars_per_page: null,
        created_at: createdAt,
        updated_at: createdAt,
        pages: [] as PdfMetadataPage[],
      };
      await writeMetadata(pdfId, metadata);

      db.prepare(
        `INSERT INTO pdfs (id, title, original_filename, status, page_count,
                           progress_step, error_message, user_prompt, require_script_confirmation,
                           tts_voice, tts_speed, script_max_chars_per_page,
                           created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, ?, ?)`,
      ).run(pdfId, title, filename, status, createdAt, createdAt);
    } catch (err) {
      request.log.error({ err, pdfId }, 'Failed to persist uploaded PDF');
      try {
        await removePdfDir(pdfId);
      } catch {
        // ignore
      }
      return reply
        .code(500)
        .send(errorResponse('INTERNAL_ERROR', 'Failed to save upload file'));
    }

    // Pipeline will be kicked off by POST /api/pdfs/:id/start once the
    // user submits a style prompt (the prompt may be empty — that just
    // means "use defaults").
    return reply.code(201).send({
      id: pdfId,
      status,
      title,
      original_filename: filename,
      user_prompt: null,
      require_script_confirmation: false,
      tts_voice: null,
      tts_speed: null,
      script_max_chars_per_page: null,
      created_at: createdAt,
    });
  });

  // POST /api/pdfs/:id/start — user submits their style prompt and asks
  // the backend to run the full pipeline. Idempotent: re-posting after
  // processing has started is a no-op (409-ish response code, not error).
  app.post('/api/pdfs/:id/start', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = StartBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(
          errorResponse(
            'INVALID_REQUEST',
            parsedBody.error.issues[0]?.message ?? 'Invalid body',
          ),
        );
    }
    const { id } = parsedParams.data;
    const row = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation,
                tts_voice, tts_speed, script_max_chars_per_page,
                created_at, updated_at
           FROM pdfs WHERE id = ?`,
      )
      .get(id) as PdfRow | undefined;
    if (!row) {
      return reply
        .code(404)
        .send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (
      row.status !== 'awaiting_prompt' &&
      row.status !== 'uploaded' &&
      row.status !== 'failed'
    ) {
      return reply.code(409).send(
        errorResponse(
          'INVALID_STATE',
          `PDF ${id} 已經在處理或已完成 (status=${row.status})，無法重新提交提示詞`,
        ),
      );
    }

    const prompt = parsedBody.data.prompt.trim();
    const requireScriptConfirmation = parsedBody.data.require_script_confirmation;
    const ttsVoice = parsedBody.data.tts_voice?.trim() || null;
    const ttsSpeed = parsedBody.data.tts_speed ?? null;
    const scriptMaxCharsPerPage = parsedBody.data.script_max_chars_per_page ?? null;
    const updatedAt = nowIso();
    db.prepare(
      `UPDATE pdfs
         SET user_prompt = ?,
             status = 'uploaded',
             require_script_confirmation = ?,
             tts_voice = ?,
             tts_speed = ?,
             script_max_chars_per_page = ?,
             error_message = NULL,
             updated_at = ?
       WHERE id = ?`,
    ).run(
      prompt.length > 0 ? prompt : null,
      requireScriptConfirmation ? 1 : 0,
      ttsVoice,
      ttsSpeed,
      scriptMaxCharsPerPage,
      updatedAt,
      id,
    );

    // Keep metadata.json in sync so the on-disk snapshot reflects the
    // submitted prompt (and the pipeline will persist further updates).
    try {
      const meta = await readMetadata(id);
      if (meta) {
        meta.user_prompt = prompt.length > 0 ? prompt : null;
        meta.require_script_confirmation = requireScriptConfirmation;
        meta.tts_voice = ttsVoice;
        meta.tts_speed = ttsSpeed;
        meta.script_max_chars_per_page = scriptMaxCharsPerPage;
        meta.status = 'uploaded';
        meta.updated_at = updatedAt;
        meta.error_message = null;
        await writeMetadata(id, meta);
      }
    } catch (err) {
      request.log.warn(
        { err, pdfId: id },
        'Failed to sync user_prompt into metadata.json (non-fatal)',
      );
    }

    enqueuePdfProcessing(id);

    return reply.code(202).send({
      id,
      status: 'uploaded' as PdfStatus,
      user_prompt: prompt.length > 0 ? prompt : null,
      require_script_confirmation: requireScriptConfirmation,
      tts_voice: ttsVoice,
      tts_speed: ttsSpeed,
      script_max_chars_per_page: scriptMaxCharsPerPage,
      updated_at: updatedAt,
    });
  });

  app.post('/api/pdfs/:id/confirm-script', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsedParams.data;
    const row = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation, created_at, updated_at
           FROM pdfs WHERE id = ?`,
      )
      .get(id) as PdfRow | undefined;
    if (!row) {
      return reply
        .code(404)
        .send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (row.status !== 'awaiting_script_confirmation') {
      return reply
        .code(409)
        .send(errorResponse('INVALID_STATE', `PDF ${id} not awaiting confirmation`));
    }

    const updatedAt = nowIso();
    db.prepare(
      `UPDATE pdfs
          SET status = 'uploaded',
              error_message = NULL,
              updated_at = ?
        WHERE id = ?`,
    ).run(updatedAt, id);

    try {
      const meta = await readMetadata(id);
      if (meta) {
        meta.status = 'uploaded';
        meta.updated_at = updatedAt;
        meta.error_message = null;
        await writeMetadata(id, meta);
      }
    } catch {
      // non-fatal
    }

    enqueuePdfProcessing(id);
    return reply.code(202).send({
      id,
      status: 'uploaded' as PdfStatus,
      user_prompt: row.user_prompt,
      require_script_confirmation: row.require_script_confirmation === 1,
      updated_at: updatedAt,
    });
  });

  // POST /api/pdfs/:id/retry
  // Retry a failed pipeline job without forcing user to resubmit prompt.
  app.post('/api/pdfs/:id/retry', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsedParams.data;
    const row = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation,
                tts_voice, tts_speed, script_max_chars_per_page,
                created_at, updated_at
           FROM pdfs WHERE id = ?`,
      )
      .get(id) as PdfRow | undefined;
    if (!row) {
      return reply
        .code(404)
        .send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (row.status !== 'failed') {
      return reply
        .code(409)
        .send(errorResponse('INVALID_STATE', `PDF ${id} is not failed`));
    }

    const updatedAt = nowIso();
    db.prepare(
      `UPDATE pdfs
          SET status = 'uploaded',
              error_message = NULL,
              progress_step = NULL,
              progress_current = NULL,
              progress_total = NULL,
              updated_at = ?
        WHERE id = ?`,
    ).run(updatedAt, id);

    try {
      const meta = await readMetadata(id);
      if (meta) {
        meta.status = 'uploaded';
        meta.error_message = null;
        meta.progress_step = null;
        meta.progress_current = null;
        meta.progress_total = null;
        meta.updated_at = updatedAt;
        await writeMetadata(id, meta);
      }
    } catch {
      // non-fatal
    }

    enqueuePdfProcessing(id);
    return reply.code(202).send({
      id,
      status: 'uploaded' as PdfStatus,
      updated_at: updatedAt,
    });
  });

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
      // Avoid UNIQUE(pdf_id, page_number) collisions during shift:
      // 1) move affected rows to a safe high range, 2) shift back.
      db.prepare(
        `UPDATE pages
            SET page_number = page_number + 100000
          WHERE pdf_id = ? AND page_number > ?`,
      ).run(id, after);
      db.prepare(
        `UPDATE pages
            SET page_number = page_number - 99999
          WHERE pdf_id = ? AND page_number > ?`,
      ).run(id, after + 100000);
      db.prepare(
        `INSERT INTO pages (pdf_id, page_number, image_path, text_path, script_path, audio_path, audio_duration_seconds, status, error_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'audio_ready', NULL, ?, ?)`,
      ).run(
        id,
        inserted,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.png`,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.text.txt`,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.script.txt`,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.mp3`,
        now,
        now,
      );
      db.prepare(`UPDATE pdfs SET page_count = ?, updated_at = ? WHERE id = ?`).run(oldCount + 1, now, id);
      rewritePagePathsToMatchNumber(id, oldCount + 1);
    });

    try {
      // Commit DB first so page numbering source-of-truth is stable.
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
        .png()
        .toFile(pageImagePath(id, inserted, oldCount + 1));
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
    const okMime = /^image\/(png|jpeg|jpg|webp)$/i.test(file.mimetype ?? '');
    if (!okMime) return reply.code(400).send(errorResponse('INVALID_MIME', 'Image must be png/jpeg/webp'));

    const imageBuffer = await file.toBuffer();
    const outPath = pageImagePath(id, n, row.page_count);
    await sharp(imageBuffer).resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } }).png().toFile(outPath);

    const relImagePath = path.posix.join('pages', `${String(n).padStart(row.page_count > 999 ? 4 : 3, '0')}.png`);
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

    return reply.code(200).send({ id, page_number: n, image_url: `/api/pdfs/${id}/pages/${n}/image`, updated_at: now });
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

    const pdfRow = db.prepare(`SELECT page_count FROM pdfs WHERE id = ?`).get(id) as { page_count: number | null } | undefined;
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

      const mergedPrompt = [
        '請產生一張 16:9 的現代知識型簡報頁，視覺風格接近 NotebookLM（資訊圖卡、清楚層級、留白充足）。',
        `頁面文字內容（參考）：\n${pageText || '(無)'}`,
        `目前逐字稿（參考）：\n${pageScript || '(無)'}`,
        `使用者修改需求：\n${prompt}`,
      ].join('\n\n');

      const edited = await client.images.generate({
        model: config.openaiImageModel,
        prompt: mergedPrompt,
        size: '1536x1024',
      });
      const b64 = edited.data?.[0]?.b64_json;
      if (!b64) throw new Error('OpenAI image edit returned empty result');
      const newBuf = Buffer.from(b64, 'base64');
      const outPath = pageImagePath(id, n, pdfRow.page_count);
      await sharp(newBuf).resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } }).png().toFile(outPath);

      const now = nowIso();
      db.prepare(`UPDATE pages SET updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(now, id, n);
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
      return reply.code(200).send({ id, page_number: n, image_url: `/api/pdfs/${id}/pages/${n}/image`, updated_at: now });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to regenerate image by prompt');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to regenerate image'));
    }
  });

  app.delete('/api/pdfs/:id/pages/:n', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid route params'));
    const { id, n } = parsed.data;
    const row = db.prepare(`SELECT * FROM pdfs WHERE id = ?`).get(id) as PdfRow | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (row.status !== 'ready' || !row.page_count || row.page_count <= 1) {
      return reply.code(409).send(errorResponse('INVALID_STATE', 'Cannot delete page in current state'));
    }
    if (n > row.page_count) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    const pageRow = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
         FROM pages WHERE pdf_id = ? AND page_number = ?`,
      )
      .get(id, n) as PageRow | undefined;
    if (!pageRow) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    const oldCount = row.page_count;
    const now = nowIso();
    try {
      const pad = (v: number) => String(v).padStart(oldCount > 999 ? 4 : 3, '0');
      const base = safeJoinPdfPath(id, 'pages');
      const removeTargets = new Set<string>();
      // Primary: remove exactly what DB points to.
      if (pageRow.image_path) removeTargets.add(safeJoinPdfPath(id, pageRow.image_path));
      if (pageRow.text_path) removeTargets.add(safeJoinPdfPath(id, pageRow.text_path));
      if (pageRow.script_path) removeTargets.add(safeJoinPdfPath(id, pageRow.script_path));
      if (pageRow.audio_path) removeTargets.add(safeJoinPdfPath(id, pageRow.audio_path));
      // Backward-compatible fallback: also remove conventional filenames.
      removeTargets.add(path.join(base, `${pad(n)}.png`));
      removeTargets.add(path.join(base, `${pad(n)}.text.txt`));
      removeTargets.add(path.join(base, `${pad(n)}.script.txt`));
      removeTargets.add(path.join(base, `${pad(n)}.mp3`));
      await Promise.all(
        Array.from(removeTargets).map(async (p) => {
          try {
            await fs.promises.rm(p, { force: true });
          } catch (err) {
            const e = err as NodeJS.ErrnoException;
            // Missing file should be treated as success (idempotent delete).
            if (e.code === 'ENOENT') return;
            throw err;
          }
        }),
      );
      await renumberPageArtifacts(
        id,
        oldCount,
        Array.from({ length: oldCount - n }, (_, i) => ({ from: n + 1 + i, to: n + i })),
      );
      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM pages WHERE pdf_id = ? AND page_number = ?`).run(id, n);
        // Avoid UNIQUE(pdf_id, page_number) collisions during compaction:
        // 1) move affected rows to a safe high range, 2) shift back to target.
        db.prepare(
          `UPDATE pages
              SET page_number = page_number + 100000
            WHERE pdf_id = ? AND page_number > ?`,
        ).run(id, n);
        db.prepare(
          `UPDATE pages
              SET page_number = page_number - 100001
            WHERE pdf_id = ? AND page_number > ?`,
        ).run(id, n + 100000);
        db.prepare(`UPDATE pdfs SET page_count = ?, updated_at = ? WHERE id = ?`).run(oldCount - 1, now, id);
        rewritePagePathsToMatchNumber(id, oldCount - 1);
      });
      tx();
      const meta = await readMetadata(id);
      if (meta) {
        meta.page_count = oldCount - 1;
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
      return reply.code(200).send({ id, page_count: oldCount - 1, updated_at: now });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to delete page');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to delete page'));
    }
  });

  // POST /api/pdfs/:id/pages/:n/regenerate-audio
  // User edits per-page script and asks backend to regenerate this page audio only.
  app.post('/api/pdfs/:id/pages/:n/regenerate-audio', async (request, reply) => {
    const parsedParams = PageParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = RegenerateAudioBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const { id, n } = parsedParams.data;
    const script = parsedBody.data.script.trim();
    const pdfRow = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation,
                tts_voice, tts_speed, script_max_chars_per_page,
                created_at, updated_at
           FROM pdfs WHERE id = ?`,
      )
      .get(id) as PdfRow | undefined;
    if (!pdfRow) {
      return reply
        .code(404)
        .send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!pdfRow.page_count || n > pdfRow.page_count) {
      return reply
        .code(404)
        .send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }

    const pageRow = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
         FROM pages WHERE pdf_id = ? AND page_number = ?`,
      )
      .get(id, n) as PageRow | undefined;
    if (!pageRow) {
      return reply
        .code(404)
        .send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }

    const pageCount = pdfRow.page_count;
    const padded = String(n).padStart(pageCount > 999 ? 4 : 3, '0');
    const relScriptPath = path.posix.join('pages', `${padded}.script.txt`);
    const relAudioPath = path.posix.join('pages', `${padded}.mp3`);
    const absScriptPath = safeJoinPdfPath(id, relScriptPath);
    const absAudioPath = safeJoinPdfPath(id, relAudioPath);

    try {
      await fs.promises.writeFile(absScriptPath, script, 'utf8');
      try {
        await fs.promises.rm(absAudioPath, { force: true });
      } catch {
        // ignore stale file removal errors
      }

      const voice = pdfRow.tts_voice?.trim() || config.openaiTtsVoice;
      const speed = pdfRow.tts_speed ?? config.openaiTtsSpeed;
      const client = getOpenAIClient();
      const ttsResp = await client.audio.speech.create({
        model: config.openaiTtsModel,
        voice,
        input: script,
        response_format: config.openaiTtsFormat,
        speed,
      });
      const audioBuffer = Buffer.from(await ttsResp.arrayBuffer());
      if (audioBuffer.byteLength === 0) {
        throw new Error('OpenAI returned empty audio buffer');
      }
      await fs.promises.writeFile(absAudioPath, audioBuffer);

      const updatedAt = nowIso();
      db.prepare(
        `UPDATE pages
            SET script_path = ?,
                audio_path = ?,
                status = 'audio_ready',
                error_message = NULL,
                updated_at = ?
          WHERE pdf_id = ? AND page_number = ?`,
      ).run(relScriptPath, relAudioPath, updatedAt, id, n);
      db.prepare(
        `UPDATE pdfs
            SET updated_at = ?
          WHERE id = ?`,
      ).run(updatedAt, id);

      try {
        const meta = await readMetadata(id);
        if (meta) {
          const page = meta.pages.find((p) => p.page_number === n);
          if (page) {
            page.script = relScriptPath;
            page.audio = relAudioPath;
            page.status = 'audio_ready';
            page.script_chars = script.length;
            page.script_generated_at = updatedAt;
            page.audio_chars = script.length;
            page.audio_generated_at = updatedAt;
          }
          meta.updated_at = updatedAt;
          await writeMetadata(id, meta);
        }
      } catch (err) {
        request.log.warn({ err, pdfId: id, pageNumber: n }, 'Failed to sync metadata after regenerate-audio');
      }

      return reply.code(200).send({
        id,
        page_number: n,
        script_url: `/api/pdfs/${id}/pages/${n}/script`,
        audio_url: `/api/pdfs/${id}/pages/${n}/audio`,
        updated_at: updatedAt,
      });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to regenerate audio from edited script');
      return reply
        .code(500)
        .send(errorResponse('INTERNAL_ERROR', 'Failed to regenerate audio'));
    }
  });

  // POST /api/pdfs/:id/pages/:n/rewrite-script
  // Rewrite current page script based on user prompt. Returns rewritten script only.
  app.post('/api/pdfs/:id/pages/:n/rewrite-script', async (request, reply) => {
    const parsedParams = PageParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = RewriteScriptBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const { id, n } = parsedParams.data;
    const prompt = parsedBody.data.prompt.trim();
    const script = parsedBody.data.script.trim();
    const history = parsedBody.data.history;

    const row = db
      .prepare(`SELECT id FROM pdfs WHERE id = ?`)
      .get(id) as { id: string } | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }

    const pageRow = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
         FROM pages WHERE pdf_id = ? AND page_number = ?`,
      )
      .get(id, n) as PageRow | undefined;
    if (!pageRow) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }

    let pageText = '';
    if (pageRow.text_path) {
      try {
        const absText = safeJoinPdfPath(id, pageRow.text_path);
        pageText = await fs.promises.readFile(absText, 'utf8');
      } catch {
        pageText = '';
      }
    }

    const RewriteSchema = z.object({
      script: z.string().min(1).max(4096),
    });

    try {
      const result = await getOpenAIClient().chat.completions.create({
        model: config.openaiLlmModel,
        messages: [
          {
            role: 'system',
            content:
              '你是逐字稿編修助理。請根據使用者提示改寫逐字稿，語言使用繁體中文。需忠於投影片內容，不可杜撰。僅輸出 JSON 物件，格式為 {"script":"..."}。',
          },
          {
            role: 'user',
            content:
              `使用者修改需求：\n${prompt}\n\n` +
              `頁面抽取文字（參考）：\n${pageText || '(無)'}\n\n` +
              `目前逐字稿：\n${script}`,
          },
        ],
        response_format: { type: 'json_object' },
        ...(config.openaiLlmModel.toLowerCase().startsWith('gpt-5.5')
          ? { max_completion_tokens: 1200 }
          : { max_tokens: 1200 }),
      });

      const raw = result.choices[0]?.message?.content ?? '';
      const parsed = RewriteSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        request.log.warn({ pdfId: id, pageNumber: n, raw }, 'rewrite-script invalid JSON shape');
        return reply
          .code(502)
          .send(errorResponse('MODEL_OUTPUT_INVALID', '模型輸出格式錯誤，請重試'));
      }

      const rewrittenScript = parsed.data.script.trim();
      const persistedHistory = [
        ...history,
        { role: 'user' as const, content: prompt },
        { role: 'assistant' as const, content: rewrittenScript },
      ];
      db.prepare(
        `UPDATE pages
         SET chat_history_json = ?, updated_at = ?
         WHERE pdf_id = ? AND page_number = ?`,
      ).run(JSON.stringify(persistedHistory), nowIso(), id, n);

      return reply.code(200).send({
        id,
        page_number: n,
        script: rewrittenScript,
      });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'rewrite-script failed');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to rewrite script'));
    }
  });

  // POST /api/pdfs/:id/generate-video
  // Manual-only video generation from existing page images + audios.
  app.post('/api/pdfs/:id/generate-video', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsedParams.data;
    const pdfRow = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation,
                tts_voice, tts_speed, script_max_chars_per_page,
                created_at, updated_at
           FROM pdfs WHERE id = ?`,
      )
      .get(id) as PdfRow | undefined;
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!pdfRow.page_count || pdfRow.page_count <= 0) {
      return reply.code(400).send(errorResponse('INVALID_STATE', 'PDF page_count is not ready'));
    }

    const pageRows = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
           FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
      )
      .all(id) as PageRow[];

    const pageNumbers = pageRows
      .filter((p) => !!p.image_path && !!p.audio_path)
      .map((p) => p.page_number);
    if (pageNumbers.length === 0) {
      return reply
        .code(400)
        .send(errorResponse('NO_AUDIO_PAGES', 'No pages with both image and audio available'));
    }

    try {
      const result = await generateVideo({
        pdfId: id,
        pageCount: pdfRow.page_count,
        pageNumbers,
      });
      const relVideo = path.relative(path.join(config.storageRoot, id), result.outputPath);
      const updatedAt = nowIso();
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(updatedAt, id);

      try {
        const meta = await readMetadata(id);
        if (meta) {
          meta.video = relVideo;
          meta.updated_at = updatedAt;
          await writeMetadata(id, meta);
        }
      } catch (err) {
        request.log.warn({ err, pdfId: id }, 'Failed to sync metadata after generate-video');
      }

      return reply.code(200).send({
        id,
        video_url: `/api/pdfs/${id}/video`,
        updated_at: updatedAt,
      });
    } catch (err) {
      request.log.error({ err, pdfId: id }, 'Failed to generate video');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to generate video'));
    }
  });

  // POST /api/pdfs/:id/pages/:n/chat
  // Multi-turn chat grounded by current page text + image URL.
  app.post('/api/pdfs/:id/pages/:n/chat', async (request, reply) => {
    const parsedParams = PageParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = PageChatBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const { id, n } = parsedParams.data;
    const { question, history } = parsedBody.data;
    const row = db
      .prepare(`SELECT id FROM pdfs WHERE id = ?`)
      .get(id) as { id: string } | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));

    const pageRow = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
         FROM pages WHERE pdf_id = ? AND page_number = ?`,
      )
      .get(id, n) as PageRow | undefined;
    if (!pageRow) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }

    let pageText = '';
    if (pageRow.text_path) {
      try {
        const absText = safeJoinPdfPath(id, pageRow.text_path);
        pageText = await fs.promises.readFile(absText, 'utf8');
      } catch {
        pageText = '';
      }
    }
    let scriptText = '';
    if (pageRow.script_path) {
      try {
        const absScript = safeJoinPdfPath(id, pageRow.script_path);
        scriptText = await fs.promises.readFile(absScript, 'utf8');
      } catch {
        scriptText = '';
      }
    }
    // Use inline data URL so local/dev environments can still provide image
    // context to OpenAI without exposing a public HTTP URL.
    let imageDataUrl: string | null = null;
    if (pageRow.image_path) {
      try {
        const absImage = safeJoinPdfPath(id, pageRow.image_path);
        const imageBuffer = await fs.promises.readFile(absImage);
        imageDataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
      } catch {
        imageDataUrl = null;
      }
    }

    try {
      const client = getOpenAIClient();
      const messages = [
        {
          role: 'system' as const,
          content:
            '你是簡報助教。請使用繁體中文回答，僅根據提供的頁面內容回答，若資訊不足要明確說明。',
        },
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: `以下是第 ${n} 頁上下文。\n\n頁面抽取文字：\n${pageText || '(無)'}\n\n頁面逐字稿：\n${scriptText || '(無)'}`,
            },
            ...(imageDataUrl
              ? [
                  {
                    type: 'image_url' as const,
                    image_url: { url: imageDataUrl, detail: 'low' as const },
                  },
                ]
              : []),
          ],
        },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: question },
      ];

      const model = config.openaiLlmModel;
      const isGpt55Family = model.toLowerCase().startsWith('gpt-5.5');
      request.log.info(
        {
          pdfId: id,
          pageNumber: n,
          model,
          historyCount: history.length,
          hasPageText: pageText.trim().length > 0,
          pageTextChars: pageText.length,
          scriptChars: scriptText.length,
          hasImage: Boolean(imageDataUrl),
          imageDataChars: imageDataUrl ? imageDataUrl.length : 0,
          questionChars: question.length,
        },
        'page chat request summary',
      );

      const chatMaxOutputTokens = 1600;

      const completion = await client.chat.completions.create({
        model,
        messages,
        ...(isGpt55Family
          ? { max_completion_tokens: chatMaxOutputTokens }
          : { max_tokens: chatMaxOutputTokens }),
      });
      request.log.info(
        {
          pdfId: id,
          pageNumber: n,
          finishReason: completion.choices[0]?.finish_reason ?? null,
          refusal: (completion.choices[0]?.message as { refusal?: unknown } | undefined)?.refusal ?? null,
          outputTokens: completion.usage?.completion_tokens ?? null,
          content: completion.choices[0]?.message?.content ?? null,
        },
        'page chat response primary',
      );
      let answer = completion.choices[0]?.message?.content?.trim() ?? '';

      // Some model responses may come back empty in multimodal mode. Retry once
      // with text-only context to maximise successful answers for end users.
      if (!answer) {
        const textOnlyMessages = [
          {
            role: 'system' as const,
            content:
              '你是簡報助教。請使用繁體中文回答，僅根據提供的頁面內容回答，若資訊不足要明確說明。',
          },
          {
            role: 'user' as const,
            content: `以下是第 ${n} 頁上下文。\n\n頁面抽取文字：\n${pageText || '(無)'}\n\n頁面逐字稿：\n${scriptText || '(無)'}`,
          },
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: question },
        ];
        const fallback = await client.chat.completions.create({
          model,
          messages: textOnlyMessages,
          ...(isGpt55Family
            ? { max_completion_tokens: chatMaxOutputTokens }
            : { max_tokens: chatMaxOutputTokens }),
        });
        request.log.info(
          {
            pdfId: id,
            pageNumber: n,
            finishReason: fallback.choices[0]?.finish_reason ?? null,
            refusal: (fallback.choices[0]?.message as { refusal?: unknown } | undefined)?.refusal ?? null,
            outputTokens: fallback.usage?.completion_tokens ?? null,
            content: fallback.choices[0]?.message?.content ?? null,
          },
          'page chat response fallback-text-only',
        );
        answer = fallback.choices[0]?.message?.content?.trim() ?? '';
      }

      if (!answer) answer = '目前無法產生回覆，請稍後再試。';
      const persistedHistory = [
        ...history,
        { role: 'user' as const, content: question },
        { role: 'assistant' as const, content: answer },
      ];
      db.prepare(
        `UPDATE pages
         SET chat_history_json = ?, updated_at = ?
         WHERE pdf_id = ? AND page_number = ?`,
      ).run(JSON.stringify(persistedHistory), nowIso(), id, n);
      return reply.send({ answer });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'page chat failed');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Chat failed'));
    }
  });

  app.get('/api/pdfs/:id/pages/:n/chat-history', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid route params'));
    }
    const { id, n } = parsed.data;
    const row = db
      .prepare(`SELECT chat_history_json FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { chat_history_json: string | null } | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }
    if (!row.chat_history_json) return reply.send({ history: [] });
    try {
      const parsedHistory = ChatHistorySchema.safeParse(JSON.parse(row.chat_history_json));
      return reply.send({ history: parsedHistory.success ? parsedHistory.data : [] });
    } catch {
      return reply.send({ history: [] });
    }
  });

  app.delete('/api/pdfs/:id/pages/:n/chat-history', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid route params'));
    }
    const { id, n } = parsed.data;
    const exists = db
      .prepare(`SELECT 1 as ok FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { ok: number } | undefined;
    if (!exists) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }
    db.prepare(
      `UPDATE pages
       SET chat_history_json = NULL, updated_at = ?
       WHERE pdf_id = ? AND page_number = ?`,
    ).run(nowIso(), id, n);
    return reply.code(204).send();
  });

  // GET /api/pdfs
  app.get('/api/pdfs', async (_request, reply) => {
    const rows = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation, created_at, updated_at
         FROM pdfs
         ORDER BY created_at DESC`,
      )
      .all() as PdfRow[];
    const items: PdfListItem[] = rows.map(rowToListItem);
    return reply.send(items);
  });

  // GET /api/pdfs/:id
  app.get('/api/pdfs/:id', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const row = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation, created_at, updated_at
         FROM pdfs WHERE id = ?`,
      )
      .get(parsed.data.id) as PdfRow | undefined;
    if (!row) {
      return reply
        .code(404)
        .send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    }
    const pages = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
         FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
      )
      .all(parsed.data.id) as PageRow[];
    return reply.send(rowToDetail(row, pages));
  });

  // GET /api/pdfs/:id/cover
  app.get('/api/pdfs/:id/cover', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const exists = db
      .prepare(`SELECT id FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as { id: string } | undefined;
    if (!exists) {
      return reply
        .code(404)
        .send(errorResponse('PDF_NOT_FOUND', 'PDF not found'));
    }
    const cover = coverImagePath(parsed.data.id);
    if (!fs.existsSync(cover)) {
      return reply
        .code(404)
        .send(errorResponse('COVER_NOT_READY', 'Cover image not generated yet'));
    }
    return streamFile(reply, cover, 'image/png', 'public, max-age=300');
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

  // GET /api/pdfs/:id/pages/:n/image
  app.get('/api/pdfs/:id/pages/:n/image', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
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
      return reply
        .code(404)
        .send(errorResponse('PAGE_IMAGE_NOT_FOUND', 'Page image not found'));
    }
    // image_path is stored relative to pdfDir; resolve safely.
    let abs: string;
    try {
      abs = safeJoinPdfPath(id, pageRow.image_path);
    } catch (err) {
      request.log.warn({ err, id, n, stored: pageRow.image_path }, 'Path traversal blocked');
      return reply
        .code(400)
        .send(errorResponse('INVALID_PATH', 'Invalid stored path'));
    }
    if (!fs.existsSync(abs)) {
      return reply
        .code(404)
        .send(errorResponse('PAGE_IMAGE_NOT_FOUND', 'Page image file missing'));
    }
    return streamFile(reply, abs, 'image/png', 'public, max-age=300');
  });

  // GET /api/pdfs/:id/pages/:n/text
  app.get('/api/pdfs/:id/pages/:n/text', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
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
      return reply
        .code(404)
        .send(errorResponse('PAGE_TEXT_NOT_FOUND', 'Page text not found'));
    }
    let abs: string;
    try {
      abs = safeJoinPdfPath(id, pageRow.text_path);
    } catch (err) {
      request.log.warn({ err, id, n, stored: pageRow.text_path }, 'Path traversal blocked');
      return reply
        .code(400)
        .send(errorResponse('INVALID_PATH', 'Invalid stored path'));
    }
    if (!fs.existsSync(abs)) {
      return reply
        .code(404)
        .send(errorResponse('PAGE_TEXT_NOT_FOUND', 'Page text file missing'));
    }
    return streamFile(reply, abs, 'text/plain; charset=utf-8', 'private, max-age=60');
  });

  // GET /api/pdfs/:id/pages/:n/script
  app.get('/api/pdfs/:id/pages/:n/script', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
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
      return reply
        .code(404)
        .send(errorResponse('PAGE_SCRIPT_NOT_FOUND', 'Page script not found'));
    }
    let abs: string;
    try {
      abs = safeJoinPdfPath(id, pageRow.script_path);
    } catch (err) {
      request.log.warn(
        { err, id, n, stored: pageRow.script_path },
        'Path traversal blocked',
      );
      return reply
        .code(400)
        .send(errorResponse('INVALID_PATH', 'Invalid stored path'));
    }
    if (!fs.existsSync(abs)) {
      return reply
        .code(404)
        .send(errorResponse('PAGE_SCRIPT_NOT_FOUND', 'Page script file missing'));
    }
    return streamFile(reply, abs, 'text/plain; charset=utf-8', 'private, max-age=60');
  });

  // GET /api/pdfs/:id/pages/:n/audio (supports HTTP Range for <audio> seeking)
  app.get('/api/pdfs/:id/pages/:n/audio', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
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
      return reply
        .code(404)
        .send(errorResponse('PAGE_AUDIO_NOT_FOUND', 'Page audio not found'));
    }
    let abs: string;
    try {
      abs = safeJoinPdfPath(id, pageRow.audio_path);
    } catch (err) {
      request.log.warn(
        { err, id, n, stored: pageRow.audio_path },
        'Path traversal blocked',
      );
      return reply
        .code(400)
        .send(errorResponse('INVALID_PATH', 'Invalid stored path'));
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return reply
        .code(404)
        .send(errorResponse('PAGE_AUDIO_NOT_FOUND', 'Page audio file missing'));
    }

    const size = stat.size;
    const rangeHeader = request.headers.range;
    reply.header('accept-ranges', 'bytes');
    reply.header('content-type', 'audio/mpeg');
    reply.header('cache-control', 'public, max-age=3600');

    if (rangeHeader) {
      // Parse `bytes=start-end`. Only support a single range.
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
        // Suffix range: last N bytes.
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
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start > end ||
        start < 0 ||
        end >= size
      ) {
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

  // DELETE /api/pdfs/:id
  app.delete('/api/pdfs/:id', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsed.data;
    const existing = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as
      | { id: string }
      | undefined;
    if (!existing) {
      return reply
        .code(404)
        .send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    // FK ON DELETE CASCADE covers `pages`.
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
    try {
      await removePdfDir(id);
    } catch (err) {
      request.log.warn({ err, pdfId: id }, 'Failed to remove storage dir (DB row already deleted)');
    }
    return reply.code(204).send();
  });
}
