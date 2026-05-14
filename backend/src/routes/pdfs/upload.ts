import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../../db';
import { config, OPENAI_TTS_VOICES } from '../../config';
import {
  createPdfDir,
  readMetadata,
  removePdfDir,
  writeMetadata,
  writeSourcePdf,
  writeSourceText,
  videoPath,
} from '../../services/storage';
import { getRuntimeAiSettings } from '../../services/aiSettings';
import { enqueuePdfProcessing } from '../../worker/pipeline';
import { generateVideo } from '../../worker/steps/generateVideo';
import type { ApiError, PageRow, PdfListItem, PdfMetadata, PdfMetadataPage, PdfRow, PdfStatus } from '../../types';
import { rowToListItem, IdParamSchema, StartBodySchema, YoutubeCreateBodySchema, nowIso, errorResponse, PDF_ID_SIZE, isSupportedVoiceByProvider, extractYoutubeVideoId } from './shared';

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
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
        image_style_prompt: null,
        created_at: createdAt,
        updated_at: createdAt,
        pages: [] as PdfMetadataPage[],
      };
      await writeMetadata(pdfId, metadata);

      db.prepare(
        `INSERT INTO pdfs (id, title, original_filename, status, page_count,
                           progress_step, error_message, user_prompt, require_script_confirmation,
                           tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt,
                           created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, ?, ?)`,
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
      image_style_prompt: null,
      created_at: createdAt,
    });
  });

  app.post('/api/youtube', async (request, reply) => {
    const parsedBody = YoutubeCreateBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const youtubeUrl = parsedBody.data.youtube_url.trim();
    const videoId = extractYoutubeVideoId(youtubeUrl);
    if (!videoId) {
      return reply.code(400).send(errorResponse('INVALID_YOUTUBE_URL', '無法解析 YouTube 影片 ID'));
    }

    const pdfId = nanoid(PDF_ID_SIZE);
    const createdAt = nowIso();
    const status: PdfStatus = 'uploaded';
    const language = parsedBody.data.language?.trim() || null;

    try {
      createPdfDir(pdfId);
      const metadata: PdfMetadata = {
        id: pdfId,
        title: `YouTube ${videoId}`,
        original_filename: youtubeUrl,
        status,
        progress_step: null,
        progress_current: null,
        progress_total: null,
        page_count: null,
        error_message: null,
        source_type: 'youtube',
        source_url: youtubeUrl,
        source_video_id: videoId,
        source_caption_language: language,
        pages: [],
        created_at: createdAt,
        updated_at: createdAt,
      };
      await writeMetadata(pdfId, metadata);

      db.prepare(
        `INSERT INTO pdfs (id, title, original_filename, status, page_count,
                           progress_step, error_message, user_prompt, require_script_confirmation,
                           tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt,
                           source_type, source_url, source_video_id, source_caption_language,
                           created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
      ).run(
        pdfId,
        `YouTube ${videoId}`,
        youtubeUrl,
        status,
        'youtube',
        youtubeUrl,
        videoId,
        language,
        createdAt,
        createdAt,
      );
    } catch (err) {
      request.log.error({ err, pdfId }, 'Failed to create youtube task');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to create youtube task'));
    }

    // YouTube tasks now follow the same prompt-first lifecycle as PDF upload:
    // keep `awaiting_prompt` here and only start pipeline when user submits
    // POST /api/pdfs/:id/start.

    return reply.code(201).send({
      id: pdfId,
      status,
      source_type: 'youtube',
      source_url: youtubeUrl,
      source_video_id: videoId,
      source_caption_language: language,
      created_at: createdAt,
    });
  });

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
                tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt,
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
    const tonePrompt = parsedBody.data.tone_prompt?.trim() || '';
    const mergedPrompt = [
      prompt,
      tonePrompt ? `【語氣提示詞】\n${tonePrompt}` : '',
    ]
      .filter((s) => s && s.trim().length > 0)
      .join('\n\n');
    const requireScriptConfirmation = parsedBody.data.require_script_confirmation;
    const ttsVoice = parsedBody.data.tts_voice?.trim() || null;
    const ttsSpeed = parsedBody.data.tts_speed ?? null;
    const runtimeForTts = getRuntimeAiSettings();
    if (ttsVoice && !isSupportedVoiceByProvider(runtimeForTts.ttsProvider, ttsVoice)) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', `不支援的 tts_voice for provider=${runtimeForTts.ttsProvider}: ${ttsVoice}`));
    }
    const scriptMaxCharsPerPage = parsedBody.data.script_max_chars_per_page ?? null;
    const imageStylePrompt = parsedBody.data.image_style_prompt?.trim() || null;
    const updatedAt = nowIso();
    db.prepare(
      `UPDATE pdfs
         SET user_prompt = ?,
             status = 'uploaded',
             require_script_confirmation = ?,
             tts_voice = ?,
             tts_speed = ?,
             script_max_chars_per_page = ?,
             image_style_prompt = ?,
             error_message = NULL,
             updated_at = ?
       WHERE id = ?`,
    ).run(
      mergedPrompt.length > 0 ? mergedPrompt : null,
      requireScriptConfirmation ? 1 : 0,
      ttsVoice,
      ttsSpeed,
      scriptMaxCharsPerPage,
      imageStylePrompt,
      updatedAt,
      id,
    );

    // Keep metadata.json in sync so the on-disk snapshot reflects the
    // submitted prompt (and the pipeline will persist further updates).
    try {
      const meta = await readMetadata(id);
      if (meta) {
        meta.user_prompt = mergedPrompt.length > 0 ? mergedPrompt : null;
        meta.require_script_confirmation = requireScriptConfirmation;
        meta.tts_voice = ttsVoice;
        meta.tts_speed = ttsSpeed;
        meta.script_max_chars_per_page = scriptMaxCharsPerPage;
        meta.image_style_prompt = imageStylePrompt;
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
      user_prompt: mergedPrompt.length > 0 ? mergedPrompt : null,
      require_script_confirmation: requireScriptConfirmation,
      tts_voice: ttsVoice,
      tts_speed: ttsSpeed,
      script_max_chars_per_page: scriptMaxCharsPerPage,
      image_style_prompt: imageStylePrompt,
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
        video_url: `api/pdfs/${id}/video`,
        updated_at: updatedAt,
      });
    } catch (err) {
      request.log.error({ err, pdfId: id }, 'Failed to generate video');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to generate video'));
    }
  });

  app.post('/api/pdfs/:id/duplicate', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }

    const { id } = parsed.data;
    const source = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation,
                tts_voice, tts_speed, script_max_chars_per_page,
                created_at, updated_at
           FROM pdfs WHERE id = ?`,
      )
      .get(id) as PdfRow | undefined;
    if (!source) {
      return reply
        .code(404)
        .send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }

    const newId = nanoid(PDF_ID_SIZE);
    const now = nowIso();
    const newTitle = `副本-${source.title ?? source.original_filename ?? source.id}`;

    try {
      const srcDir = path.join(config.storageRoot, id);
      const dstDir = path.join(config.storageRoot, newId);
      await fs.promises.cp(srcDir, dstDir, { recursive: true });

      const metadata = await readMetadata(id);
      if (!metadata) {
        throw new Error('metadata not found');
      }
      await writeMetadata(newId, {
        ...metadata,
        id: newId,
        title: newTitle,
        original_filename: metadata.original_filename,
        status: metadata.status,
        progress_step: metadata.progress_step,
        progress_current: metadata.progress_current,
        progress_total: metadata.progress_total,
        page_count: metadata.page_count,
        error_message: metadata.error_message,
        pages: metadata.pages,
        created_at: now,
        updated_at: now,
      });

      db.prepare(
        `INSERT INTO pdfs (id, title, original_filename, status, page_count,
                           progress_step, progress_current, progress_total,
                           error_message, user_prompt, require_script_confirmation,
                           tts_voice, tts_speed, script_max_chars_per_page,
                           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId,
        newTitle,
        source.original_filename,
        source.status,
        source.page_count,
        source.progress_step,
        source.progress_current,
        source.progress_total,
        source.error_message,
        source.user_prompt,
        source.require_script_confirmation,
        source.tts_voice,
        source.tts_speed,
        source.script_max_chars_per_page,
        now,
        now,
      );

      const pages = db
        .prepare(
          `SELECT pdf_id, page_number, image_path, text_path, script_path,
                  audio_path, audio_duration_seconds, status, error_message,
                  created_at, updated_at
             FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
        )
        .all(id) as PageRow[];
      const insertPage = db.prepare(
        `INSERT INTO pages (pdf_id, page_number, image_path, text_path, script_path,
                            audio_path, audio_duration_seconds, status, error_message,
                            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const p of pages) {
        insertPage.run(
          newId,
          p.page_number,
          p.image_path,
          p.text_path,
          p.script_path,
          p.audio_path,
          p.audio_duration_seconds,
          p.status,
          p.error_message,
          now,
          now,
        );
      }
    } catch (err) {
      request.log.error({ err, from: id, to: newId }, 'Failed to duplicate pdf');
      try {
        await removePdfDir(newId);
      } catch {
        // ignore
      }
      db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(newId);
      db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(newId);
      return reply
        .code(500)
        .send(errorResponse('INTERNAL_ERROR', 'Failed to duplicate pdf'));
    }

    const row = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count, progress_step,
                progress_current, progress_total,
                error_message, user_prompt, require_script_confirmation,
                tts_voice, tts_speed, script_max_chars_per_page,
                created_at, updated_at
           FROM pdfs WHERE id = ?`,
      )
      .get(newId) as PdfRow;
    return reply.code(201).send(rowToListItem(row));
  });

}
