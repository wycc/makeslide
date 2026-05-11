import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db';
import { config, OPENAI_TTS_VOICES } from '../config';
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
  youtubeOutlinePath,
  writeMetadata,
  writeSourcePdf,
  writeSourceText,
} from '../services/storage';
import { callChatJSON, getOpenAIClient, setOpenAIApiKeyRuntime } from '../services/openai';
import { getRuntimeAiSettings, persistEnvSettings, setRuntimeAiSettings } from '../services/aiSettings';
import { synthesizeGeminiSpeech } from '../services/gemini';
import { buildImagePrompt, IMAGE_PROMPT_TEMPLATES } from '../services/imagePromptTemplates';
import { enqueuePdfProcessing, enqueueYoutubeProcessing } from '../worker/pipeline';
import { generateVideo } from '../worker/steps/generateVideo';
import {
  getRegenerateJob,
  requestCancelRegenerateJob,
  rollbackRegenerate,
  startRegenerateJob,
} from '../worker/regenerate';
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
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';

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
  tts_voice: z.enum(OPENAI_TTS_VOICES).optional(),
  tts_speed: z.number().min(0.25).max(4).optional(),
  script_max_chars_per_page: z.number().int().min(80).max(2000).optional(),
  tone_prompt: z.string().max(1000, 'tone_prompt 不可超過 1000 字').optional(),
  image_style_prompt: z.string().max(8000, 'image_style_prompt 不可超過 8000 字').optional(),
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

const TTS_TONE_MARKER_RE = /\[\[\s*([^\]]+)\s*\]\]/g;

function splitTtsSegments(script: string): Array<{ instruction: string; text: string }> {
  const out: Array<{ instruction: string; text: string }> = [];
  let currentInstruction = '平穩敘述';
  let lastIdx = 0;
  TTS_TONE_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TTS_TONE_MARKER_RE.exec(script)) !== null) {
    const seg = script.slice(lastIdx, m.index).trim();
    if (seg) out.push({ instruction: currentInstruction, text: seg });
    currentInstruction = (m[1] ?? '').trim() || '平穩敘述';
    lastIdx = m.index + m[0].length;
  }
  const tail = script.slice(lastIdx).trim();
  if (tail) out.push({ instruction: currentInstruction, text: tail });
  if (out.length === 0 && script.trim()) {
    out.push({ instruction: '平穩敘述', text: script.trim() });
  }
  return out;
}

const RewriteScriptBodySchema = z.object({
  prompt: z.string().max(2000, 'prompt 不可超過 2000 字'),
  script: z.string().max(4096, 'script 不可超過 4096 字'),
  previous_script: z.string().max(4096, 'previous_script 不可超過 4096 字').optional().default(''),
  current_script: z.string().max(4096, 'current_script 不可超過 4096 字').optional().default(''),
  next_script: z.string().max(4096, 'next_script 不可超過 4096 字').optional().default(''),
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

const MovePageBodySchema = z.object({
  from_page_number: z.number().int().positive(),
  to_page_number: z.number().int().positive(),
});

const UpdateTtsSettingsBodySchema = z.object({
  tts_voice: z.enum(OPENAI_TTS_VOICES, { message: '不支援的 tts_voice' }),
  tts_speed: z.number().min(0.25, 'tts_speed 過小').max(4, 'tts_speed 過大'),
});

const UpdateImageStyleSettingsBodySchema = z.object({
  image_style_prompt: z
    .string()
    .max(8000, 'image_style_prompt 不可超過 8000 字')
    .optional()
    .default(''),
});

const UpdateTitleBodySchema = z.object({
  title: z.string().min(1, 'title 不可為空').max(200, 'title 過長'),
});

const UpdatePromptBodySchema = z.object({
  prompt: z.string().max(MAX_USER_PROMPT_CHARS, `提示詞不可超過 ${MAX_USER_PROMPT_CHARS} 字`),
});

const YoutubeCreateBodySchema = z.object({
  youtube_url: z.string().url('youtube_url 格式錯誤'),
  language: z.string().trim().min(2).max(16).optional(),
});

const RegenerateAllImagesBodySchema = z.object({
  prompt: z.string().min(1, 'prompt 不可為空').max(4000, 'prompt 不可超過 4000 字'),
});

const RegenerateBatchBodySchema = z.object({
  scripts: z
    .object({
      prompt: z
        .string()
        .max(2000, 'prompt 不可超過 2000 字')
        .optional()
        .default(''),
    })
    .optional(),
  audio: z
        .object({
          voice: z.enum(OPENAI_TTS_VOICES).optional(),
          speed: z.number().min(0.25).max(4).optional(),
        })
    .optional(),
  images: z
    .object({
      prompt: z
        .string()
        .min(1, 'images.prompt 不可為空')
        .max(4000, 'images.prompt 不可超過 4000 字'),
    })
    .optional(),
});

function errorResponse(code: string, message: string): ApiError {
  return { error: { code, message } };
}

function nowIso(): string {
  return new Date().toISOString();
}

function detectAudioMimeFromBuffer(buf: Buffer): 'audio/mpeg' | 'audio/wav' | 'application/octet-stream' {
  if (buf.length >= 12) {
    const riff = buf.toString('ascii', 0, 4);
    const wave = buf.toString('ascii', 8, 12);
    if (riff === 'RIFF' && wave === 'WAVE') return 'audio/wav';
  }
  if (buf.length >= 3) {
    const id3 = buf.toString('ascii', 0, 3);
    if (id3 === 'ID3') return 'audio/mpeg';
  }
  if (buf.length >= 2) {
    const b0 = buf[0] ?? 0;
    const b1 = buf[1] ?? 0;
    // MP3 frame sync: 0xFFEx
    if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return 'audio/mpeg';
  }
  return 'application/octet-stream';
}

function parseWavPcmChunk(buf: Buffer): { sampleRate: number; channels: number; bitsPerSample: number; data: Buffer } | null {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const start = off + 8;
    const end = start + size;
    if (end > buf.length) break;
    if (id === 'data') return { sampleRate, channels, bitsPerSample, data: buf.subarray(start, end) };
    off = end + (size % 2);
  }
  return null;
}

function buildWavPcm16(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

function rewritePagePathsToMatchNumber(pdfId: string, pageCount: number): void {
  const pad = pageCount > 999 ? 4 : 3;
  db.prepare(
    `UPDATE pages
        SET image_path = 'pages/' || printf('%0${pad}d', page_number) || '.jpg',
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
  // Cover exists iff cover.jpg/cover.png is on disk. For efficiency, probe once here
  // instead of stat-ing for every list row; M2 ensures cover is written as
  // soon as page 1 is rendered.
  try {
    const coverJpg = coverImagePath(row.id);
    const coverPng = path.join(config.storageRoot, row.id, 'cover.png');
    return (fs.existsSync(coverJpg) || fs.existsSync(coverPng))
      ? `api/pdfs/${row.id}/cover`
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
    image_style_prompt: row.image_style_prompt ?? null,
    source_type: row.source_type ?? 'pdf',
    source_url: row.source_url ?? null,
    source_video_id: row.source_video_id ?? null,
    source_caption_language: row.source_caption_language ?? null,
    created_at: row.created_at,
  };
}

function rowToDetail(row: PdfRow, pages: PageRow[]): PdfDetail {
  const detailPages: PdfDetailPage[] = pages.map((p) => ({
    page_number: p.page_number,
    image_url: p.image_path ? `api/pdfs/${row.id}/pages/${p.page_number}/image` : null,
    text_url: p.text_path ? `api/pdfs/${row.id}/pages/${p.page_number}/text` : null,
    script_url: p.script_path ? `api/pdfs/${row.id}/pages/${p.page_number}/script` : null,
    audio_url: p.audio_path ? `api/pdfs/${row.id}/pages/${p.page_number}/audio` : null,
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
    image_style_prompt: row.image_style_prompt ?? null,
    source_type: row.source_type ?? 'pdf',
    source_url: row.source_url ?? null,
    source_video_id: row.source_video_id ?? null,
    source_caption_language: row.source_caption_language ?? null,
    outline_url: fs.existsSync(youtubeOutlinePath(row.id)) ? `api/pdfs/${row.id}/outline` : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    video_url: fs.existsSync(videoPath(row.id)) ? `api/pdfs/${row.id}/video` : null,
    pages: detailPages,
  };
}

function extractYoutubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id && id.length >= 6 ? id : null;
    }
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v');
      if (id && id.length >= 6) return id;
      const parts = u.pathname.split('/').filter(Boolean);
      const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts');
      if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
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
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.jpg`,
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
        .jpeg({ quality: 82, mozjpeg: true })
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

  // POST /api/pdfs/:id/pages/move
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
    const pdfRow = db.prepare(`SELECT page_count FROM pdfs WHERE id = ?`).get(id) as { page_count: number | null } | undefined;
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
      db.prepare(`UPDATE pages SET page_number = page_number + 100000 WHERE pdf_id = ?`).run(id);
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
    // Clipboard paste from some browsers may send empty/odd mimetype
    // (e.g. application/octet-stream). Validate by actual decodability.
    try {
      const meta = await sharp(imageBuffer).metadata();
      if (!meta.format) {
        return reply.code(400).send(errorResponse('INVALID_MIME', 'Image must be decodable')); 
      }
    } catch {
      return reply.code(400).send(errorResponse('INVALID_MIME', 'Image must be decodable'));
    }

    const outPath = pageImagePath(id, n, row.page_count);
    await sharp(imageBuffer).resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(outPath);

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

      const mergedPrompt = buildImagePrompt({
        stylePrompt: IMAGE_PROMPT_TEMPLATES[0]?.prompt_en,
        pageText,
        pageScript,
        userAdjustmentPrompt: prompt,
      });

      const edited = await client.images.generate({
        model: config.openaiImageModel,
        prompt: mergedPrompt,
        size: '1536x1024',
      });
      const b64 = edited.data?.[0]?.b64_json;
      if (!b64) throw new Error('OpenAI image edit returned empty result');
      const newBuf = Buffer.from(b64, 'base64');
      const outPath = pageImagePath(id, n, pdfRow.page_count);
      await sharp(newBuf).resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(outPath);

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
      return reply.code(200).send({ id, page_number: n, image_url: `api/pdfs/${id}/pages/${n}/image`, updated_at: now });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to regenerate image by prompt');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to regenerate image'));
    }
  });

  app.patch('/api/pdfs/:id/tts-settings', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = UpdateTtsSettingsBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const { id } = parsedParams.data;
    const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as { id: string } | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));

    const ttsVoice = parsedBody.data.tts_voice.trim();
    const ttsSpeed = parsedBody.data.tts_speed;
    const updatedAt = nowIso();

    db.prepare(
      `UPDATE pdfs
          SET tts_voice = ?,
              tts_speed = ?,
              updated_at = ?
        WHERE id = ?`,
    ).run(ttsVoice, ttsSpeed, updatedAt, id);

    try {
      const meta = await readMetadata(id);
      if (meta) {
        meta.tts_voice = ttsVoice;
        meta.tts_speed = ttsSpeed;
        meta.updated_at = updatedAt;
        await writeMetadata(id, meta);
      }
    } catch {
      // non-fatal
    }

    return reply.code(200).send({ id, tts_voice: ttsVoice, tts_speed: ttsSpeed, updated_at: updatedAt });
  });

  app.patch('/api/pdfs/:id/image-style-settings', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = UpdateImageStyleSettingsBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const { id } = parsedParams.data;
    const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as { id: string } | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));

    const imageStylePrompt = parsedBody.data.image_style_prompt.trim() || null;
    const updatedAt = nowIso();
    db.prepare(`UPDATE pdfs SET image_style_prompt = ?, updated_at = ? WHERE id = ?`).run(imageStylePrompt, updatedAt, id);

    try {
      const meta = await readMetadata(id);
      if (meta) {
        meta.image_style_prompt = imageStylePrompt;
        meta.updated_at = updatedAt;
        await writeMetadata(id, meta);
      }
    } catch {
      // non-fatal
    }

    return reply.code(200).send({ id, image_style_prompt: imageStylePrompt, updated_at: updatedAt });
  });

  app.post('/api/pdfs/:id/regenerate-images', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = RegenerateAllImagesBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id } = parsedParams.data;
    const prompt = parsedBody.data.prompt.trim();

    const pdfRow = db
      .prepare(`SELECT page_count FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null } | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!pdfRow.page_count || pdfRow.page_count <= 0) {
      return reply.code(409).send(errorResponse('INVALID_STATE', 'PDF page_count not ready'));
    }

    const pageRows = db
      .prepare(`SELECT page_number, text_path, script_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
      .all(id) as Array<{ page_number: number; text_path: string | null; script_path: string | null }>;

    try {
      const client = getOpenAIClient();
      for (const p of pageRows) {
        let pageText = '';
        let pageScript = '';
        if (p.text_path) {
          try {
            pageText = await fs.promises.readFile(safeJoinPdfPath(id, p.text_path), 'utf8');
          } catch {
            pageText = '';
          }
        }
        if (p.script_path) {
          try {
            pageScript = await fs.promises.readFile(safeJoinPdfPath(id, p.script_path), 'utf8');
          } catch {
            pageScript = '';
          }
        }

        const mergedPrompt = buildImagePrompt({
          stylePrompt: IMAGE_PROMPT_TEMPLATES[0]?.prompt_en,
          deckAdjustmentPrompt: prompt,
          pageText,
          pageScript,
        });

        const generated = await client.images.generate({
          model: config.openaiImageModel,
          prompt: mergedPrompt,
          size: '1536x1024',
        });
        const b64 = generated.data?.[0]?.b64_json;
        if (!b64) throw new Error(`OpenAI generate returned empty result at page ${p.page_number}`);
        const newBuf = Buffer.from(b64, 'base64');
        const outPath = pageImagePath(id, p.page_number, pdfRow.page_count);
        await sharp(newBuf)
          .resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: 82, mozjpeg: true })
          .toFile(outPath);
      }

      const updatedAt = nowIso();
      db.prepare(`UPDATE pages SET updated_at = ? WHERE pdf_id = ?`).run(updatedAt, id);
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(updatedAt, id);
      try {
        const meta = await readMetadata(id);
        if (meta) {
          meta.updated_at = updatedAt;
          await writeMetadata(id, meta);
        }
      } catch {
        // non-fatal
      }

      return reply.code(200).send({ id, page_count: pdfRow.page_count, updated_at: updatedAt });
    } catch (err) {
      request.log.error({ err, pdfId: id }, 'Failed to regenerate all images');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to regenerate all images'));
    }
  });

  // POST /api/pdfs/:id/regenerate
  // 啟動一個批次重生任務，可同時包含「逐字稿 / 語音 / 圖檔」三種項目。
  // 後端以固定順序 image → script → audio 依序執行，並在記憶體中保存進度，
  // 前端可透過 GET /api/pdfs/:id/regenerate/status 輪詢。
  app.post('/api/pdfs/:id/regenerate', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = RegenerateBatchBodySchema.safeParse(request.body ?? {});
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
    const body = parsedBody.data;

    const row = db
      .prepare(`SELECT id, page_count FROM pdfs WHERE id = ?`)
      .get(id) as { id: string; page_count: number | null } | undefined;
    if (!row) {
      return reply
        .code(404)
        .send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!row.page_count || row.page_count <= 0) {
      return reply
        .code(409)
        .send(errorResponse('INVALID_STATE', 'PDF page_count 尚未就緒'));
    }

    if (!body.scripts && !body.audio && !body.images) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', '請至少選擇一個重生項目'));
    }

    try {
      const state = startRegenerateJob(id, {
        scripts: body.scripts ? { prompt: body.scripts.prompt || null } : null,
        audio: body.audio
          ? {
              voice: body.audio.voice ?? null,
              speed: body.audio.speed ?? null,
            }
          : null,
        images: body.images ? { prompt: body.images.prompt } : null,
      });
      return reply.code(202).send(state);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'JOB_ALREADY_RUNNING') {
        return reply
          .code(409)
          .send(errorResponse('JOB_ALREADY_RUNNING', '已有重生任務正在執行'));
      }
      if (code === 'NO_STEPS_SELECTED') {
        return reply
          .code(400)
          .send(errorResponse('INVALID_REQUEST', '請至少選擇一個重生項目'));
      }
      if (code === 'INVALID_STATE') {
        return reply
          .code(409)
          .send(errorResponse('INVALID_STATE', 'PDF 狀態不允許重生'));
      }
      if (code === 'PDF_NOT_FOUND') {
        return reply
          .code(404)
          .send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
      }
      request.log.error({ err, pdfId: id }, 'Failed to start regenerate job');
      return reply
        .code(500)
        .send(errorResponse('INTERNAL_ERROR', 'Failed to start regenerate job'));
    }
  });

  // GET /api/pdfs/:id/regenerate/status
  // 查詢最近一次（或目前正在進行中）的批次重生任務狀態。
  app.get('/api/pdfs/:id/regenerate/status', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsedParams.data;
    const state = getRegenerateJob(id);
    if (!state) {
      return reply
        .code(404)
        .send(errorResponse('JOB_NOT_FOUND', '沒有任何重生任務紀錄'));
    }
    return reply.send(state);
  });

  // GET /api/system/image-prompt-templates
  // 回傳生圖專用風格模板，供前端顯示與讓使用者二次編輯。
  app.get('/api/system/image-prompt-templates', async (_request, reply) => {
    return reply.send({
      templates: IMAGE_PROMPT_TEMPLATES,
      default_template_key: IMAGE_PROMPT_TEMPLATES[0]?.key ?? null,
    });
  });

  app.get('/api/system/openai-key-status', async (_request, reply) => {
    const runtime = getRuntimeAiSettings();
    const hasKey = Boolean(runtime.openaiApiKey?.trim());
    return reply.send({ has_key: hasKey });
  });

  app.patch('/api/system/openai-api-key', async (request, reply) => {
    const BodySchema = z.object({ api_key: z.string().trim().min(1) });
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'api_key is required'));
    }

    const envPath = path.join(config.repoRoot, '.env');
    const nextKey = parsed.data.api_key.trim();
    let content = '';
    if (fs.existsSync(envPath)) content = await fs.promises.readFile(envPath, 'utf8');

    const line = `OPENAI_API_KEY=${nextKey}`;
    if (/^OPENAI_API_KEY=.*/m.test(content)) content = content.replace(/^OPENAI_API_KEY=.*/m, line);
    else content = content.trimEnd() + `\n${line}\n`;

    await fs.promises.writeFile(envPath, content, 'utf8');
    setOpenAIApiKeyRuntime(nextKey);
    setRuntimeAiSettings({ openaiApiKey: nextKey });
    return reply.send({ ok: true, has_key: true });
  });

  app.get('/api/system/ai-settings', async (_request, reply) => {
    const runtime = getRuntimeAiSettings();
    return reply.send({
      openai_api_key: runtime.openaiApiKey,
      gemini_api_key: runtime.geminiApiKey,
      has_openai_key: Boolean(runtime.openaiApiKey.trim()),
      has_gemini_key: Boolean(runtime.geminiApiKey.trim()),
      llm_provider: runtime.llmProvider,
      tts_provider: runtime.ttsProvider,
      openai_llm_model: runtime.openaiLlmModel,
      gemini_llm_model: runtime.geminiLlmModel,
      openai_tts_model: runtime.openaiTtsModel,
      gemini_tts_model: runtime.geminiTtsModel,
    });
  });

  app.patch('/api/system/ai-settings', async (request, reply) => {
    const BodySchema = z.object({
      openai_api_key: z.string().trim().min(1).optional(),
      gemini_api_key: z.string().trim().min(1).optional(),
      llm_provider: z.enum(['openai', 'gemini']).optional(),
      tts_provider: z.enum(['openai', 'gemini']).optional(),
      openai_llm_model: z.string().trim().min(1).optional(),
      gemini_llm_model: z.string().trim().min(1).optional(),
      openai_tts_model: z.string().trim().min(1).optional(),
      gemini_tts_model: z.string().trim().min(1).optional(),
    });
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid AI settings payload'));
    }

    const next = parsed.data;
    const runtimeUpdate = {
      ...(next.openai_api_key ? { openaiApiKey: next.openai_api_key } : {}),
      ...(next.gemini_api_key ? { geminiApiKey: next.gemini_api_key } : {}),
      ...(next.llm_provider ? { llmProvider: next.llm_provider } : {}),
      ...(next.tts_provider ? { ttsProvider: next.tts_provider } : {}),
      ...(next.openai_llm_model ? { openaiLlmModel: next.openai_llm_model } : {}),
      ...(next.gemini_llm_model ? { geminiLlmModel: next.gemini_llm_model } : {}),
      ...(next.openai_tts_model ? { openaiTtsModel: next.openai_tts_model } : {}),
      ...(next.gemini_tts_model ? { geminiTtsModel: next.gemini_tts_model } : {}),
    };

    await persistEnvSettings(runtimeUpdate);
    const runtime = setRuntimeAiSettings(runtimeUpdate);
    if (runtimeUpdate.openaiApiKey) {
      setOpenAIApiKeyRuntime(runtimeUpdate.openaiApiKey);
    }

    return reply.send({
      openai_api_key: runtime.openaiApiKey,
      gemini_api_key: runtime.geminiApiKey,
      has_openai_key: Boolean(runtime.openaiApiKey.trim()),
      has_gemini_key: Boolean(runtime.geminiApiKey.trim()),
      llm_provider: runtime.llmProvider,
      tts_provider: runtime.ttsProvider,
      openai_llm_model: runtime.openaiLlmModel,
      gemini_llm_model: runtime.geminiLlmModel,
      openai_tts_model: runtime.openaiTtsModel,
      gemini_tts_model: runtime.geminiTtsModel,
    });
  });

  // POST /api/pdfs/:id/regenerate/cancel
  // 請求停止目前正在執行中的批次重生任務。實際停止時機為下一個安全檢查點
  // （每頁 / 步驟切換之間），已在飛行中的請求會讓它完成再停。
  app.post('/api/pdfs/:id/regenerate/cancel', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsedParams.data;
    try {
      const state = requestCancelRegenerateJob(id);
      return reply.code(202).send(state);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'JOB_NOT_FOUND') {
        return reply
          .code(404)
          .send(errorResponse('JOB_NOT_FOUND', '沒有找到可取消的重生任務'));
      }
      if (code === 'JOB_NOT_ACTIVE') {
        return reply
          .code(409)
          .send(errorResponse('JOB_NOT_ACTIVE', '目前任務已結束，無法取消'));
      }
      request.log.error({ err, pdfId: id }, 'Failed to cancel regenerate job');
      return reply
        .code(500)
        .send(errorResponse('INTERNAL_ERROR', 'Failed to cancel regenerate job'));
    }
  });

  // POST /api/pdfs/:id/regenerate/rollback
  // 還原最近一次啟動重生前的快照：針對每頁的圖片 / 逐字稿 / 語音三種資產，
  // 若快照中「原本有檔案」就覆蓋回去，若「原本不存在」則刪除目前的檔案；
  // 同時還原 pages 表對應的欄位（status / *_path / audio_duration_seconds）。
  app.post('/api/pdfs/:id/regenerate/rollback', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsedParams.data;
    const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as
      | { id: string }
      | undefined;
    if (!row) {
      return reply
        .code(404)
        .send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    try {
      const result = await rollbackRegenerate(id);
      return reply.code(200).send({
        id,
        ...result,
      });
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'SNAPSHOT_NOT_FOUND') {
        return reply
          .code(404)
          .send(errorResponse('SNAPSHOT_NOT_FOUND', '找不到可還原的快照'));
      }
      if (code === 'JOB_STILL_RUNNING') {
        return reply
          .code(409)
          .send(
            errorResponse(
              'JOB_STILL_RUNNING',
              '仍有重生任務在執行中，請先停止再還原',
            ),
          );
      }
      request.log.error({ err, pdfId: id }, 'Failed to rollback regenerate');
      return reply
        .code(500)
        .send(errorResponse('INTERNAL_ERROR', 'Failed to rollback regenerate'));
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

      const runtime = getRuntimeAiSettings();
      const ttsProvider = runtime.ttsProvider;
      const voice = pdfRow.tts_voice?.trim() || config.openaiTtsVoice;
      const speed = pdfRow.tts_speed ?? config.openaiTtsSpeed;
      const client = ttsProvider === 'openai' ? getOpenAIClient() : null;
      const segments = splitTtsSegments(script);
      const buffers: Buffer[] = [];
      for (const seg of segments) {
        request.log.info(
          {
            pdfId: id,
            pageNumber: n,
            instruction: seg.instruction,
            text: seg.text,
          },
          'regenerate-audio: tts segment request',
        );
        let b: Buffer;
        if (ttsProvider === 'gemini') {
          b = await synthesizeGeminiSpeech({
            model: runtime.geminiTtsModel,
            text: seg.text,
            voiceName: voice,
          });
        } else {
          const ttsResp = await client!.audio.speech.create({
            model: runtime.openaiTtsModel || config.openaiTtsModel,
            voice,
            instructions: seg.instruction,
            input: seg.text,
            response_format: config.openaiTtsFormat,
            speed,
          });
          b = Buffer.from(await ttsResp.arrayBuffer());
        }
        if (b.byteLength === 0) {
          throw new Error(`${ttsProvider} returned empty audio buffer`);
        }
        buffers.push(b);
      }
      let audioBuffer: Buffer;
      if (ttsProvider === 'gemini') {
        const parsed = buffers.map((b) => parseWavPcmChunk(b));
        const first = parsed.find((p) => p !== null) ?? null;
        if (first && first.bitsPerSample === 16) {
          const pcm = Buffer.concat(
            parsed
              .map((p, idx) => {
                if (!p) return buffers[idx] ?? Buffer.alloc(0);
                return p.data;
              })
              .filter((b) => b.length > 0),
          );
          audioBuffer = buildWavPcm16(pcm, first.sampleRate, first.channels);
        } else {
          audioBuffer = Buffer.concat(buffers);
        }
      } else {
        audioBuffer = Buffer.concat(buffers);
      }
      if (audioBuffer.byteLength === 0) {
        throw new Error(`${ttsProvider} returned empty audio buffer`);
      }
      await fs.promises.writeFile(absAudioPath, audioBuffer);
      request.log.info(
        {
          pdfId: id,
          pageNumber: n,
          voice,
          speed,
          audioBytes: audioBuffer.byteLength,
          audioPath: relAudioPath,
        },
        'Regenerate-audio completed',
      );

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

      const responseAudioMime = detectAudioMimeFromBuffer(audioBuffer);
      return reply.code(200).send({
        id,
        page_number: n,
        script_url: `api/pdfs/${id}/pages/${n}/script`,
        audio_url: `api/pdfs/${id}/pages/${n}/audio`,
        audio_bytes: audioBuffer.byteLength,
        audio_mime: responseAudioMime,
        updated_at: updatedAt,
      });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to regenerate audio from edited script');
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Failed to regenerate audio';
      const safeMsg = msg.slice(0, 300);
      try {
        db.prepare(
          `UPDATE pages
              SET status = 'failed',
                  error_message = ?,
                  updated_at = ?
            WHERE pdf_id = ? AND page_number = ?`,
        ).run(safeMsg, nowIso(), id, n);
      } catch {
        // ignore secondary DB error
      }
      return reply
        .code(500)
        .send(errorResponse('INTERNAL_ERROR', `Failed to regenerate audio: ${safeMsg}`));
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
    const previousScript = parsedBody.data.previous_script.trim();
    const currentScript = parsedBody.data.current_script.trim();
    const nextScript = parsedBody.data.next_script.trim();
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

    let imageDataUrl = '';
    if (pageRow.image_path) {
      try {
        const absImage = safeJoinPdfPath(id, pageRow.image_path);
        const imgBuf = await sharp(absImage)
          .resize({ width: config.openaiScriptImageMaxWidth, withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer();
        imageDataUrl = `data:image/jpeg;base64,${imgBuf.toString('base64')}`;
      } catch {
        imageDataUrl = '';
      }
    }

    const RewriteSchema = z.object({
      script: z.string().min(1).max(4096),
    });

    try {
      const userContent: ChatCompletionContentPart[] = [
        {
          type: 'text',
          text:
            `使用者修改需求：\n${prompt}\n\n` +
            `前一頁逐字稿（銜接參考）：\n${previousScript || '(無)'}\n\n` +
            `本頁原逐字稿（優先保留核心意思）：\n${currentScript || script || '(無)'}\n\n` +
            `下一頁逐字稿（銜接參考）：\n${nextScript || '(無)'}\n\n` +
            `頁面抽取文字（參考）：\n${pageText || '(無)'}\n\n` +
            `目前逐字稿：\n${script || '(無)'}\n\n` +
            '請改寫成適合 TTS 朗讀的逐字稿。\n\n' +
            '要求：\n' +
            '1. 使用自然口語，不要像書面文章。\n' +
            '2. 每句話盡量短。\n' +
            '3. 重要概念前後加入停頓。\n' +
            '4. 加入少量「好」、「那我們來看」、「這裡有一個重點」等自然轉場。\n' +
            '5. 避免過度誇張，不要像廣告配音。\n' +
            '6. 語氣像老師在課堂上清楚解釋。\n' +
            '7. 輸出時保留段落換行，方便 TTS 產生停頓。\n\n' +
            '請改寫本頁逐字稿，並確保與前後頁的語意與語氣銜接順暢；若上下文不足，仍需先產出可朗讀草稿。',
        },
      ];
      if (imageDataUrl) {
        userContent.push({
          type: 'image_url',
          image_url: { url: imageDataUrl, detail: 'auto' },
        });
      }

      const runtime = getRuntimeAiSettings();
      const llmModel =
        runtime.llmProvider === 'gemini' ? runtime.geminiLlmModel : runtime.openaiLlmModel;

      const geminiPodcastRules = [
        '根據以下文章內容，整理出雙人 Podcast 逐字稿，遵循以下規則：',
        '- 逐字稿使用繁體中文。',
        '- 逐字稿總長度約 1000 字。',
        '- 分別有 主持人 "Speaker 1" 與 主持人 "Speaker 2"，"Speaker 1" 為台灣人年輕女性、"Speaker 2" 為台灣人年輕男性。',
        '- 如果有必要，主持人互相使用 "你" 稱呼。',
        '- 皆使用台灣用語、台灣連接詞，可以適時使用台灣狀聲詞。',
        '- 如果有需要描述語氣、情緒，使用 "{{}}"，例如 "{{哈哈大笑}}" 或 "{{難過情緒}}"。',
        '- 只需要輸出逐字稿，不需要其他說明。',
      ].join('\n');

      const openaiRules = [
        '請改寫成適合 TTS 朗讀的逐字稿。',
        '要求：',
        '1. 使用自然口語，不要像書面文章。',
        '2. 每句話盡量短。',
        '3. 重要概念前後加入停頓。',
        '4. 加入少量「好」、「那我們來看」、「這裡有一個重點」等自然轉場。',
        '5. 避免過度誇張，不要像廣告配音。',
        '6. 語氣像老師在課堂上清楚解釋。',
        '7. 輸出時保留段落換行，方便 TTS 產生停頓。',
        '8. 輸出 JSON，格式固定為 {"script":"..."}。',
      ].join('\n');

      const systemPrompt =
        runtime.ttsProvider === 'gemini'
          ? `你是逐字稿編修助理。${geminiPodcastRules}\n請回傳 JSON，格式固定為 {"script":"..."}。`
          : `你是逐字稿編修助理。${openaiRules}`;

      const { data } = await callChatJSON({
        model: llmModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        schema: RewriteSchema,
        label: `rewrite-script p${n}`,
        maxTokens: 4800,
        temperature: 0.5,
      });

      const parsed = RewriteSchema.safeParse(data);
      if (!parsed.success) {
        request.log.warn({ pdfId: id, pageNumber: n, data }, 'rewrite-script invalid JSON shape');
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
        video_url: `api/pdfs/${id}/video`,
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
        imageDataUrl = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
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

      const chatMaxOutputTokens = 6400;

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
                error_message, user_prompt, require_script_confirmation,
                tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt,
                source_type, source_url, source_video_id, source_caption_language,
                created_at, updated_at
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

  // PATCH /api/pdfs/:id/title
  app.patch('/api/pdfs/:id/title', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
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
    const legacyCoverPng = path.join(config.storageRoot, parsed.data.id, 'cover.png');

    if (!fs.existsSync(cover) && fs.existsSync(legacyCoverPng)) {
      try {
        await sharp(legacyCoverPng)
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(cover);
      } catch (err) {
        request.log.warn({ err, id: parsed.data.id }, 'Failed to convert legacy cover.png to cover.jpg');
      }
    }

    const coverPath = fs.existsSync(cover)
      ? cover
      : (fs.existsSync(legacyCoverPng) ? legacyCoverPng : null);
    if (!coverPath) {
      return reply
        .code(404)
        .send(errorResponse('COVER_NOT_READY', 'Cover image not generated yet'));
    }
    const mime = coverPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return streamFile(reply, coverPath, mime, 'public, max-age=300');
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
    const legacyPng = abs.replace(/\.jpg$/i, '.png');
    let imagePath = abs;
    if (!fs.existsSync(imagePath) && fs.existsSync(legacyPng)) {
      try {
        await sharp(legacyPng)
          .jpeg({ quality: 82, mozjpeg: true })
          .toFile(imagePath);
      } catch (err) {
        request.log.warn({ err, id, n }, 'Failed to convert legacy page png to jpg');
      }
    }
    if (!fs.existsSync(imagePath) && fs.existsSync(legacyPng)) {
      imagePath = legacyPng;
    }
    if (!fs.existsSync(imagePath)) {
      return reply
        .code(404)
        .send(errorResponse('PAGE_IMAGE_NOT_FOUND', 'Page image file missing'));
    }
    const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return streamFile(reply, imagePath, mime, 'public, max-age=300');
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

  // POST /api/pdfs/:id/duplicate
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
