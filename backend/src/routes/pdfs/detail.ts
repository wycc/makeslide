import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { db } from '../../db';
import { config } from '../../config';
import type { PageRow, PdfListItem, PdfRow } from '../../types';
import { coverImagePath, readMetadata, safeJoinPdfPath, videoPath, writeMetadata, youtubeOutlinePath } from '../../services/storage';
import { ensureCoverThumbnail, ensurePageThumbnail, generateCoverThumbnail } from '../../services/thumbnails';
import {
  IdParamSchema,
  PageParamSchema,
  DEFAULT_PDF_CATEGORY,
  UpdateCategoryBodySchema,
  UpdatePromptBodySchema,
  UpdateTitleBodySchema,
  detectAudioMimeFromBuffer,
  errorResponse,
  nowIso,
  rowToDetail,
  rowToListItem,
  streamFile,
  timingRowsToPageMap,
} from './shared';

export async function registerDetailRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/pdfs
  app.get('/api/pdfs', async (_request, reply) => {
    const rows = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                 progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation, category, created_at, updated_at
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
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const row = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation,
                category,
                tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt,
                source_type, source_url, source_video_id, source_caption_language,
                created_at, updated_at
         FROM pdfs WHERE id = ?`,
      )
      .get(parsed.data.id) as PdfRow | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
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
    return reply.send(rowToDetail(row, pages, timingRowsToPageMap(timingRows)));
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
    const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as { id: string } | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
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
    const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as { id: string } | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
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
