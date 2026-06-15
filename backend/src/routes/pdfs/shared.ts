import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../../db';
import { config, OPENAI_TTS_VOICES } from '../../config';
import {
  coverImagePath,
  coverThumbnailPath,
  createPdfDir,
  readMetadata,
  removePdfDir,
  safeJoinPdfPath,
  videoPath,
  youtubeOutlinePath,
  writeMetadata,
  writeSourcePdf,
  writeSourceText,
} from '../../services/storage';
import { callChatJSON, getOpenAIClient, setOpenAIApiKeyRuntime } from '../../services/openai';
import { getRuntimeAiSettings, persistEnvSettings, setRuntimeAiSettings } from '../../services/aiSettings';
import { accountIdFromOwnerSub } from '../../services/accountContext';
import { synthesizeGeminiSpeech } from '../../services/gemini';
import { loadPromptTemplate } from '../../services/promptTemplates';
import { buildImagePrompt, IMAGE_PROMPT_TEMPLATES } from '../../services/imagePromptTemplates';
import { enqueuePdfProcessing, enqueueYoutubeProcessing } from '../../worker/pipeline';
import { generateVideo } from '../../worker/steps/generateVideo';
import {
  getRegenerateJob,
  requestCancelRegenerateJob,
  rollbackRegenerate,
  startRegenerateJob,
} from '../../worker/regenerate';
import type {
  ApiError,
  PageRow,
  PdfDetail,
  PdfDetailPage,
  PdfDetailPageTimingItem,
  PdfDetailPageTimings,
  PdfListItem,
  PdfMetadata,
  PdfMetadataPage,
  PdfRow,
  PdfStatus,
} from '../../types';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';

export const PDF_ID_SIZE = 10;
export const DEFAULT_PDF_CATEGORY = 'general';
export const MAX_UPLOAD_FILENAME_CHARS = 180;

const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED_FILENAME_CHARS_RE = /[<>:"/\\|?*]/g;
const SAFE_FALLBACK_FILENAME = 'upload';

// pdf_id: nanoid alphanumeric + _ - only; our ids are 10-chars.
// Accept a slightly wider window (8-32) for forward compat but enforce charset.
const PDF_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

export const IdParamSchema = z.object({
  id: z.string().regex(PDF_ID_RE, 'Invalid pdf id'),
});

// Body for POST /api/pdfs/:id/start — optional freeform style hint from
// the user. We cap length to avoid embedding megabytes of prompt into the
// DB or the per-page LLM call.
const MAX_USER_PROMPT_CHARS = 2000;
const GEMINI_TTS_VOICES = [
  'Kore',
  'Puck',
  'Charon',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
] as const;

export function isSupportedVoiceByProvider(provider: 'openai' | 'gemini', voice: string): boolean {
  const pool = provider === 'gemini' ? GEMINI_TTS_VOICES : OPENAI_TTS_VOICES;
  return (pool as readonly string[]).includes(voice);
}

export const StartBodySchema = z.object({
  prompt: z
    .string()
    .max(MAX_USER_PROMPT_CHARS, `提示詞不可超過 ${MAX_USER_PROMPT_CHARS} 字`)
    .optional()
    .default(''),
  require_script_confirmation: z.boolean().optional().default(false),
  require_split_confirmation: z.boolean().optional().default(false),
  tts_voice: z.string().trim().min(1).optional(),
  tts_speed: z.number().min(0.25).max(4).optional(),
  script_max_chars_per_page: z.number().int().min(80).max(2000).optional(),
  tone_prompt: z.string().max(1000, 'tone_prompt 不可超過 1000 字').optional(),
  image_style_prompt: z.string().max(8000, 'image_style_prompt 不可超過 8000 字').optional(),
});

export const PageParamSchema = z.object({
  id: z.string().regex(PDF_ID_RE, 'Invalid pdf id'),
  n: z
    .string()
    .regex(/^[1-9]\d{0,4}$/, 'Invalid page number')
    .transform((v) => Number(v))
    .pipe(z.number().int().positive().max(99999)),
});

export const RegenerateAudioBodySchema = z.object({
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

export const RewriteScriptBodySchema = z.object({
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

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

export const RegenerateImageBodySchema = z.object({
  prompt: z.string().min(1, 'prompt 不可為空').max(2000, 'prompt 不可超過 2000 字'),
  history: z.array(ChatMessageSchema).max(20).optional().default([]),
});

const ChatHistorySchema = z.array(ChatMessageSchema);

const PageChatBodySchema = z.object({
  question: z.string().min(1, 'question 不可為空').max(4000, 'question 不可超過 4000 字'),
  history: z.array(ChatMessageSchema).max(20).optional().default([]),
});

export const AddPageBodySchema = z.object({
  after_page_number: z.number().int().min(0).optional().default(0),
});

export const MovePageBodySchema = z.object({
  from_page_number: z.number().int().positive(),
  to_page_number: z.number().int().positive(),
});

const UpdateTtsSettingsBodySchema = z.object({
  tts_voice: z.string().trim().min(1, '不支援的 tts_voice'),
  tts_speed: z.number().min(0.25, 'tts_speed 過小').max(4, 'tts_speed 過大'),
});

const UpdateImageStyleSettingsBodySchema = z.object({
  image_style_prompt: z
    .string()
    .max(8000, 'image_style_prompt 不可超過 8000 字')
    .optional()
    .default(''),
});

export const UpdateTitleBodySchema = z.object({
  title: z.string().min(1, 'title 不可為空').max(200, 'title 過長'),
});

export const UpdateCategoryBodySchema = z.object({
  category: z.string().trim().min(1, 'category 不可為空').max(80, 'category 過長'),
});

export const UpdateVisibilityBodySchema = z.object({
  visibility: z.enum(['private', 'public', 'public_editable']),
});

export const UpdatePromptBodySchema = z.object({
  prompt: z.string().max(MAX_USER_PROMPT_CHARS, `提示詞不可超過 ${MAX_USER_PROMPT_CHARS} 字`),
});

export const CreatePollBodySchema = z.object({
  question: z.string().trim().min(1, 'question 不可為空').max(300, 'question 不可超過 300 字'),
  options: z
    .array(z.string().trim().min(1, '選項不可為空').max(120, '選項不可超過 120 字'))
    .min(2, '至少需要 2 個選項')
    .max(6, '最多 6 個選項'),
  show_results: z.boolean().optional().default(true),
});

export const PollParamSchema = z.object({
  id: z.string().regex(PDF_ID_RE, 'Invalid pdf id'),
  pollId: z
    .string()
    .regex(/^[1-9]\d{0,9}$/, 'Invalid poll id')
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
});

export const VotePollBodySchema = z.object({
  voter_id: z.string().trim().min(1, 'voter_id 太短').max(128, 'voter_id 過長'),
  option_index: z.number().int().min(0).max(5),
});

export const YoutubeCreateBodySchema = z.object({
  youtube_url: z
    .string()
    .trim()
    .url('youtube_url 格式錯誤')
    .max(2048, 'youtube_url 過長')
    .refine((value) => {
      try {
        const host = new URL(value).hostname.toLowerCase();
        return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
      } catch {
        return false;
      }
    }, '僅支援 YouTube 網址'),
  language: z.string().trim().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/, 'language 格式錯誤').optional(),
  host_mode: z.enum(['solo', 'dual']).optional(),
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
      script_max_chars_per_page: z
        .number()
        .int()
        .min(80, 'script_max_chars_per_page 不可小於 80')
        .max(2000, 'script_max_chars_per_page 不可大於 2000')
        .optional(),
    })
    .optional(),
  audio: z
        .object({
          voice: z.string().trim().min(1).optional(),
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
  animations: z.object({}).optional(),
  page_numbers: z
    .array(z.number().int().min(1))
    .optional(),
});

export const UpdateSystemAiSettingsBodySchema = z.object({
  openai_api_key: z.string().optional(),
  openai_base_url: z.string().optional(),
  gemini_api_key: z.string().optional(),
  llm_provider: z.enum(['openai', 'gemini']).optional(),
  tts_provider: z.enum(['openai', 'gemini']).optional(),
  openai_llm_model: z.string().optional(),
  gemini_llm_model: z.string().optional(),
  openai_tts_model: z.string().optional(),
  gemini_tts_model: z.string().optional(),
  gemini_tts_speaker1: z.string().optional(),
  gemini_tts_speaker2: z.string().optional(),
  gemini_tts_speaker1_voice: z.string().optional(),
  gemini_tts_speaker2_voice: z.string().optional(),
  openai_tts_speaker1: z.string().optional(),
  openai_tts_speaker2: z.string().optional(),
  openai_tts_speaker1_voice: z.string().optional(),
  openai_tts_speaker2_voice: z.string().optional(),
  user_code: z.string().max(128).optional(),
  ui_language: z.enum(['zh-TW', 'en']).optional(),
  content_language: z.enum(['zh-TW', 'en']).optional(),
  google_auth_enabled: z.boolean().optional(),
  google_client_id: z.string().optional(),
  google_client_secret: z.string().optional(),
  google_redirect_uri: z.string().optional(),
  github_repo_url: z.string().optional(),
  github_token: z.string().optional(),
  auto_generate_animation: z.boolean().optional(),
});

export { RegenerateBatchBodySchema };

export function errorResponse(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS_RE, '');
}

export function sanitizeUploadFilename(filename: string | undefined | null, fallbackExt = ''): string {
  const base = path.basename(stripControlChars(filename?.trim() || SAFE_FALLBACK_FILENAME));
  const sanitized = base
    .replace(WINDOWS_RESERVED_FILENAME_CHARS_RE, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, MAX_UPLOAD_FILENAME_CHARS);
  const fallback = `${SAFE_FALLBACK_FILENAME}${fallbackExt}`;
  return sanitized || fallback;
}

export function titleFromUploadFilename(filename: string): string {
  const parsed = path.parse(filename);
  return stripControlChars(parsed.name).trim().slice(0, 200) || filename;
}

export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

export function looksLikeUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  const decoded = buffer.toString('utf8');
  return Buffer.from(decoded, 'utf8').equals(buffer);
}

export function detectAudioMimeFromBuffer(buf: Buffer): 'audio/mpeg' | 'audio/wav' | 'application/octet-stream' {
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

/**
 * Shift page_number by `delta` in all child tables that reference pages.
 * Must be called inside the same transaction as the corresponding pages UPDATE.
 * Use `filter` to limit which pages are shifted:
 *   - 'all'         → every page of this PDF
 *   - { gt: N }     → only page_number > N
 *   - { gtTmp: N }  → only page_number > N (use after the first +100000 temp shift)
 */
export function shiftChildPageNumbers(
  pdfId: string,
  delta: number,
  filter: 'all' | { gt: number },
): void {
  if (filter === 'all') {
    db.prepare(`UPDATE page_polls SET page_number = page_number + ? WHERE pdf_id = ?`).run(
      delta,
      pdfId,
    );
  } else {
    db.prepare(
      `UPDATE page_polls SET page_number = page_number + ? WHERE pdf_id = ? AND page_number > ?`,
    ).run(delta, pdfId, filter.gt);
  }
}

function coverCacheKey(row: PdfRow): string {
  return encodeURIComponent(row.updated_at || row.created_at || row.id);
}

function withCoverCacheKey(url: string, row: PdfRow): string {
  return `${url}?t=${coverCacheKey(row)}`;
}

function coverUrl(row: PdfRow): string | null {
  // Cover exists iff cover.jpg/cover.png is on disk. For efficiency, probe once here
  // instead of stat-ing for every list row; M2 ensures cover is written as
  // soon as page 1 is rendered.
  try {
    const coverJpg = coverImagePath(row.id);
    const coverPng = path.join(config.storageRoot, row.id, 'cover.png');
    return (fs.existsSync(coverJpg) || fs.existsSync(coverPng))
      ? withCoverCacheKey(`api/pdfs/${row.id}/cover`, row)
      : null;
  } catch {
    return null;
  }
}

function coverThumbnailUrl(row: PdfRow): string | null {
  try {
    const coverThumb = coverThumbnailPath(row.id);
    const coverJpg = coverImagePath(row.id);
    const coverPng = path.join(config.storageRoot, row.id, 'cover.png');
    return (fs.existsSync(coverThumb) || fs.existsSync(coverJpg) || fs.existsSync(coverPng))
      ? withCoverCacheKey(`api/pdfs/${row.id}/cover/thumbnail`, row)
      : null;
  } catch {
    return null;
  }
}

export function rowToListItem(row: PdfRow): PdfListItem {
  const runtime = getRuntimeAiSettings(accountIdFromOwnerSub(row.owner_sub));
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    page_count: row.page_count,
    progress_step: row.progress_step,
    progress_current: row.progress_current,
    progress_total: row.progress_total,
    cover_url: coverUrl(row),
    cover_thumbnail_url: coverThumbnailUrl(row),
    user_prompt: row.user_prompt,
    require_script_confirmation: row.require_script_confirmation === 1,
    require_split_confirmation: row.require_split_confirmation === 1,
    category: row.category?.trim() || DEFAULT_PDF_CATEGORY,
    owner_sub: row.owner_sub ?? null,
    visibility: row.visibility ?? 'private',
    tts_provider: runtime.ttsProvider,
    tts_voice: row.tts_voice,
    tts_speed: row.tts_speed,
    host_mode: row.host_mode === 'dual' ? 'dual' : 'solo',
    script_max_chars_per_page: row.script_max_chars_per_page,
    image_style_prompt: row.image_style_prompt ?? null,
    total_audio_duration_seconds: row.total_audio_duration_seconds ?? null,
    source_type: row.source_type ?? 'pdf',
    source_url: row.source_url ?? null,
    source_video_id: row.source_video_id ?? null,
    source_caption_language: row.source_caption_language ?? null,
    github_synced_at: row.github_synced_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export type PageTimingsByPage = Map<number, PdfDetailPageTimings>;

const emptyPageTimings = (): PdfDetailPageTimings => ({ image: null, text: null, script: null, audio: null });

export function timingRowsToPageMap(rows: Array<{
  page_number: number;
  artifact: PdfDetailPageTimingItem['artifact'];
  status: PdfDetailPageTimingItem['status'];
  duration_ms: number | null;
  started_at: string | null;
  ended_at: string | null;
  sla_target_ms: number | null;
  sla_status: PdfDetailPageTimingItem['sla_status'];
  run_id: string | null;
  attempt: number | null;
  reason: PdfDetailPageTimingItem['reason'];
  error_code: string | null;
  error_message: string | null;
}>): PageTimingsByPage {
  const map: PageTimingsByPage = new Map();
  for (const r of rows) {
    const timings = map.get(r.page_number) ?? emptyPageTimings();
    timings[r.artifact] = {
      artifact: r.artifact,
      status: r.status,
      duration_ms: r.duration_ms,
      started_at: r.started_at,
      ended_at: r.ended_at,
      sla_target_ms: r.sla_target_ms,
      sla_status: r.sla_status,
      run_id: r.run_id,
      attempt: r.attempt,
      reason: r.reason,
      error_code: r.error_code,
      error_message: r.error_message,
    };
    map.set(r.page_number, timings);
  }
  return map;
}

export function rowToDetail(row: PdfRow, pages: PageRow[], timingsByPage: PageTimingsByPage = new Map()): PdfDetail {
  const runtime = getRuntimeAiSettings(accountIdFromOwnerSub(row.owner_sub));
  const detailPages: PdfDetailPage[] = pages.map((p) => ({
    page_number: p.page_number,
    image_url: p.image_path ? `api/pdfs/${row.id}/pages/${p.page_number}/image` : null,
    thumbnail_url: p.image_path ? `api/pdfs/${row.id}/pages/${p.page_number}/thumbnail` : null,
    text_url: p.text_path ? `api/pdfs/${row.id}/pages/${p.page_number}/text` : null,
    script_url: p.script_path ? `api/pdfs/${row.id}/pages/${p.page_number}/script` : null,
    audio_url: p.audio_path ? `api/pdfs/${row.id}/pages/${p.page_number}/audio` : null,
    audio_duration_seconds: p.audio_duration_seconds,
    render_type: p.render_type === 'gsap-image' ? 'gsap-image' : 'static-image',
    animation_spec_url: p.animation_spec_path
      ? `api/pdfs/${row.id}/pages/${p.page_number}/animation/spec`
      : null,
    status: p.status,
    error_message: p.error_message,
    timings: timingsByPage.get(p.page_number) ?? emptyPageTimings(),
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
    require_split_confirmation: row.require_split_confirmation === 1,
    category: row.category?.trim() || DEFAULT_PDF_CATEGORY,
    owner_sub: row.owner_sub ?? null,
    visibility: row.visibility ?? 'private',
    tts_provider: runtime.ttsProvider,
    tts_voice: row.tts_voice,
    tts_speed: row.tts_speed,
    host_mode: row.host_mode === 'dual' ? 'dual' : 'solo',
    script_max_chars_per_page: row.script_max_chars_per_page,
    image_style_prompt: row.image_style_prompt ?? null,
    total_audio_duration_seconds: row.total_audio_duration_seconds ?? null,
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

export function extractYoutubeVideoId(url: string): string | null {
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

export function streamFile(
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

// Serve an audio file with HTTP Range support so <audio> elements can seek.
// Callers are responsible for checking the file exists / mapping 404s before
// invoking this — it assumes `absPath` points at a readable file.
export function sendAudioFile(request: FastifyRequest, reply: FastifyReply, absPath: string): FastifyReply {
  const stat = fs.statSync(absPath);
  const size = stat.size;
  const rangeHeader = request.headers.range;
  reply.header('accept-ranges', 'bytes');
  let contentType: string = 'audio/mpeg';
  try {
    const head = Buffer.alloc(16);
    const fd = fs.openSync(absPath, 'r');
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
    return reply.send(fs.createReadStream(absPath, { start, end }));
  }

  reply.header('content-length', String(size));
  return reply.send(fs.createReadStream(absPath));
}
