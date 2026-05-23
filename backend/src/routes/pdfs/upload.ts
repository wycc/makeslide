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
  sourcePdfPath,
  writeMetadata,
  writeSourcePdf,
  writeSourceText,
  videoPath,
} from '../../services/storage';
import { getRuntimeAiSettings } from '../../services/aiSettings';
import { callChatJSON } from '../../services/openai';
import { extractPdfText } from '../../worker/poppler';
import { enqueuePdfProcessing } from '../../worker/pipeline';
import { generateVideo } from '../../worker/steps/generateVideo';
import type { ApiError, PageRow, PdfListItem, PdfMetadata, PdfMetadataPage, PdfRow, PdfStatus } from '../../types';
import { rowToListItem, IdParamSchema, StartBodySchema, YoutubeCreateBodySchema, nowIso, errorResponse, PDF_ID_SIZE, DEFAULT_PDF_CATEGORY, isSupportedVoiceByProvider, extractYoutubeVideoId, looksLikePdf, looksLikeUtf8Text, sanitizeUploadFilename, titleFromUploadFilename } from './shared';
import { decodeSession, parseCookies } from '../auth';

function ownerSubFromRequest(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

const PromptTextBodySchema = z.object({
  prompt: z.string().trim().min(10, 'prompt 至少需要 10 個字').max(4000, 'prompt 不可超過 4000 字'),
});

const PromptChatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20),
});

const PromptChatSchema = z.object({
  assistant_message: z.string().min(1).max(2000),
  outline_text: z.string().min(1).max(12000),
});

const PdfImportModeSchema = z.enum(['slides', 'document']);

function multipartFieldValue(field: unknown): string | undefined {
  const first = Array.isArray(field) ? field[0] : field;
  if (!first || typeof first !== 'object') return undefined;
  const value = (first as { value?: unknown }).value;
  return typeof value === 'string' ? value : undefined;
}

function shouldDeferTitleToAiForTxtImport(filename: string): boolean {
  const normalized = path.basename(filename).toLowerCase();
  return normalized === 'pasted.txt' || normalized === 'prompt-outline.txt';
}

const PromptTextSchema = z.object({
  title: z.string().min(1).max(120),
  slides: z
    .array(
      z
        .object({
          title: z.string().min(1).max(160),
          bullets: z.array(z.string().min(1).max(300)).min(2).max(6).optional(),
          points: z.array(z.string().min(1).max(300)).min(2).max(6).optional(),
        })
        .transform((slide, ctx) => {
          const bullets = slide.bullets ?? slide.points;
          if (!bullets) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: '每頁投影片必須包含 bullets 陣列',
              path: ['bullets'],
            });
            return z.NEVER;
          }
          return { title: slide.title, bullets };
        }),
    )
    .min(3)
    .max(20),
});

function renderPromptText(data: z.infer<typeof PromptTextSchema>): string {
  return data.slides
    .map((slide, idx) => {
      const lines = [`Slide ${idx + 1}: ${slide.title.trim()}`];
      for (const bullet of slide.bullets) {
        const trimmed = bullet.trim();
        if (trimmed) lines.push(`- ${trimmed}`);
      }
      return lines.join('\n');
    })
    .join('\n\n')
    .trim();
}

async function continuePromptOutlineChat(
  messages: z.infer<typeof PromptChatBodySchema>['messages'],
): Promise<z.infer<typeof PromptChatSchema>> {
  const conversation = messages
    .map((message) => `${message.role === 'user' ? '使用者' : 'AI'}：${message.content}`)
    .join('\n\n');
  const result = await callChatJSON({
    messages: [
      {
        role: 'system',
        content: [
          '你是簡報大綱規劃助理，目標是透過多輪對話協助使用者逐步完成可匯入 TXT 流程的簡報大綱。',
          '請根據目前對話產生下一則助理回覆，並同步維護一份完整 outline_text。',
          'assistant_message 應該自然、簡潔，指出目前大綱狀態，必要時只問 1 到 3 個最重要的澄清問題。',
          'outline_text 必須是可直接匯入 TXT 流程的投影片文字，格式使用 Slide 1: 標題，下一行用 - 表示 2 到 6 個重點。',
          '即使資訊不足，也要依目前資訊提供合理草稿；使用者後續回答時再更新 outline_text。',
          '務必輸出 JSON，不要輸出 markdown。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          '以下是目前對話紀錄，請延續對話並更新簡報大綱。',
          '',
          conversation,
          '',
          '請輸出：',
          '{"assistant_message":"給使用者的下一則回覆","outline_text":"完整 TXT 投影片大綱"}',
        ].join('\n'),
      },
    ],
    schema: PromptChatSchema,
    maxTokens: 5000,
    temperature: 0.5,
    label: 'prompt-outline-chat',
  });
  return result.data;
}

async function generateSlideTextFromPrompt(prompt: string): Promise<{ title: string; text: string }> {
  const result = await callChatJSON({
    messages: [
      {
        role: 'system',
        content: [
          '你是簡報內容企劃助理。',
          '請根據使用者提示詞產生可匯入 TXT 流程的投影片文字。',
          '務必輸出結構化 JSON，不要輸出 markdown。',
          'JSON 格式必須完全符合：{"title":"簡報標題","slides":[{"title":"頁面標題","bullets":["重點1","重點2"]}]}。',
          '每一頁只能使用 bullets 欄位表示重點，不要使用 points、items、content 或其他欄位名稱。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          '請根據以下需求規劃 3 到 12 頁投影片。',
          '每頁需要清楚 title 與 2 到 6 個 bullets。',
          '內容要足夠完整，讓後續 TXT 上傳流程能產生完整簡報。',
          '請只輸出 JSON 物件，slides 內每個項目都必須包含 title 與 bullets。',
          '',
          '使用者提示詞：',
          prompt,
        ].join('\n'),
      },
    ],
    schema: PromptTextSchema,
    maxTokens: 6400,
    temperature: 0.5,
    label: 'prompt-to-slide-text',
  });
  return {
    title: result.data.title.trim(),
    text: renderPromptText(result.data),
  };
}

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/prompt-chat', async (request, reply) => {
    const parsedBody = PromptChatBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    try {
      const result = await continuePromptOutlineChat(parsedBody.data.messages);
      return reply.send(result);
    } catch (err) {
      request.log.error({ err }, 'Failed to continue prompt outline chat');
      return reply
        .code(502)
        .send(errorResponse('LLM_GENERATION_FAILED', err instanceof Error ? err.message : 'Failed to continue prompt outline chat'));
    }
  });

  app.post('/api/prompt-text', async (request, reply) => {
    const parsedBody = PromptTextBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    let generated: { title: string; text: string };
    try {
      generated = await generateSlideTextFromPrompt(parsedBody.data.prompt);
    } catch (err) {
      request.log.error({ err }, 'Failed to generate slide text from prompt');
      return reply
        .code(502)
        .send(errorResponse('LLM_GENERATION_FAILED', err instanceof Error ? err.message : 'Failed to generate slide text'));
    }

    if (!generated.text) {
      return reply.code(502).send(errorResponse('LLM_GENERATION_FAILED', 'Generated slide text is empty'));
    }

    const pdfId = nanoid(PDF_ID_SIZE);
    const createdAt = nowIso();
    const title = generated.title || '提示詞生成簡報';
    const filename = `${titleFromUploadFilename(title)}.txt`;
    const status: PdfStatus = 'awaiting_prompt';
    const ownerSub = ownerSubFromRequest(request);

    try {
      createPdfDir(pdfId);
      await writeSourceText(pdfId, generated.text);
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
        category: DEFAULT_PDF_CATEGORY,
        owner_sub: ownerSub,
        visibility: 'private',
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
                            category, owner_sub, visibility,
                            tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt,
                            created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
      ).run(pdfId, title, filename, status, DEFAULT_PDF_CATEGORY, ownerSub, 'private', createdAt, createdAt);
    } catch (err) {
      request.log.error({ err, pdfId }, 'Failed to persist prompt generated TXT');
      try {
        await removePdfDir(pdfId);
      } catch {
        // ignore
      }
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to save generated TXT'));
    }

    return reply.code(201).send({
      id: pdfId,
      status,
      title,
      original_filename: filename,
      user_prompt: null,
      require_script_confirmation: false,
      category: DEFAULT_PDF_CATEGORY,
      tts_voice: null,
      tts_speed: null,
      script_max_chars_per_page: null,
      image_style_prompt: null,
      created_at: createdAt,
    });
  });

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

    const pdfImportModeValue = multipartFieldValue(file.fields.pdf_import_mode);
    const parsedPdfImportMode = PdfImportModeSchema.safeParse(
      typeof pdfImportModeValue === 'string' ? pdfImportModeValue : 'slides',
    );
    if (!parsedPdfImportMode.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'pdf_import_mode 必須是 slides 或 document'));
    }
    const pdfImportMode = parsedPdfImportMode.data;

    const filename = sanitizeUploadFilename(file.filename, '.pdf');
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

    if (isPdf && !looksLikePdf(buffer)) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_UPLOAD_CONTENT', 'PDF 檔案內容格式不正確'));
    }

    if (isTxt && !looksLikeUtf8Text(buffer)) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_UPLOAD_CONTENT', 'TXT 檔案必須是 UTF-8 文字內容'));
    }

    const pdfId = nanoid(PDF_ID_SIZE);
    const createdAt = nowIso();
    const title = isTxt && shouldDeferTitleToAiForTxtImport(filename)
      ? null
      : titleFromUploadFilename(filename);
    // Do NOT start the pipeline here — wait for the user to submit a
    // style / tone prompt via POST /api/pdfs/:id/start.
    const status: PdfStatus = 'awaiting_prompt';
    const ownerSub = ownerSubFromRequest(request);

    try {
      createPdfDir(pdfId);
      if (isPdf) {
        await writeSourcePdf(pdfId, buffer);
        if (pdfImportMode === 'document') {
          const extractedText = await extractPdfText(sourcePdfPath(pdfId));
          if (!extractedText) {
            throw new Error('PDF 文件模式無法抽取可分頁文字');
          }
          await writeSourceText(pdfId, extractedText);
        }
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
        category: DEFAULT_PDF_CATEGORY,
        owner_sub: ownerSub,
        visibility: 'private',
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
                            category, owner_sub, visibility,
                            tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt,
                            created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
      ).run(pdfId, title, filename, status, DEFAULT_PDF_CATEGORY, ownerSub, 'private', createdAt, createdAt);
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
      category: DEFAULT_PDF_CATEGORY,
      tts_voice: null,
      tts_speed: null,
      script_max_chars_per_page: null,
      image_style_prompt: null,
      created_at: createdAt,
      has_source_text: isTxt || pdfImportMode === 'document',
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
    const ownerSub = ownerSubFromRequest(request);

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
        category: DEFAULT_PDF_CATEGORY,
        owner_sub: ownerSub,
        visibility: 'private',
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
                            category, owner_sub, visibility,
                            tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt,
                            source_type, source_url, source_video_id, source_caption_language,
                            created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
      ).run(
        pdfId,
        `YouTube ${videoId}`,
        youtubeUrl,
        status,
        DEFAULT_PDF_CATEGORY,
        ownerSub,
        'private',
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
      category: DEFAULT_PDF_CATEGORY,
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
    const requireSplitConfirmation = parsedBody.data.require_split_confirmation;
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
             require_split_confirmation = ?,
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
      requireSplitConfirmation ? 1 : 0,
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
        meta.require_split_confirmation = requireSplitConfirmation;
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
      require_split_confirmation: requireSplitConfirmation,
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
                category, tts_voice, tts_speed, script_max_chars_per_page,
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
        category: metadata.category?.trim() || source.category?.trim() || DEFAULT_PDF_CATEGORY,
        pages: metadata.pages,
        created_at: now,
        updated_at: now,
      });

      db.prepare(
        `INSERT INTO pdfs (id, title, original_filename, status, page_count,
                            progress_step, progress_current, progress_total,
                            error_message, user_prompt, require_script_confirmation,
                            category,
                            tts_voice, tts_speed, script_max_chars_per_page,
                            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        source.category?.trim() || DEFAULT_PDF_CATEGORY,
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
