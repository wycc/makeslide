import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

export const OPENAI_TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
] as const;

// Load .env from repo root (one level above backend/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
// Also allow backend/.env for local overrides
dotenv.config({ path: path.join(repoRoot, 'backend', '.env'), override: false });
// In container deployment, also allow runtime overrides from jovyan home.
dotenv.config({ path: '/home/jovyan/.env', override: false });

const EnvSchema = z.object({
  PORT: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 3000))
    .pipe(z.number().int().positive()),
  STORAGE_ROOT: z.string().optional().default('./storage'),
  DB_PATH: z.string().optional().default('./data/app.db'),
  MAX_UPLOAD_MB: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 50))
    .pipe(z.number().int().positive()),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional()
    .default('info'),
  // M2: pipeline settings
  PROCESS_CONCURRENCY: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 2))
    .pipe(z.number().int().positive()),
  RENDER_DPI: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 150))
    .pipe(z.number().int().positive()),
  POPPLER_BIN_PATH: z.string().optional().default(''),
  // M3: OpenAI LLM settings. API key is validated lazily inside the pipeline
  // so the server can still boot (and serve M2 endpoints) without a key.
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_LLM_MODEL: z.string().optional().default('gpt-4o-mini'),
  OPENAI_SCRIPT_LANGUAGE: z.string().optional().default('zh-TW'),
  OPENAI_SCRIPT_TARGET_CHARS: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 150))
    .pipe(z.number().int().positive()),
  OPENAI_SCRIPT_STYLE: z.string().optional().default('natural_spoken'),
  // 是否將該頁投影片 PNG 圖像一併送給 LLM（vision 模型才有效果）。
  OPENAI_SCRIPT_USE_IMAGES: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  // 送給 LLM 前先縮圖到這個寬度（px），避免 token 爆炸。
  OPENAI_SCRIPT_IMAGE_MAX_WIDTH: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 1024))
    .pipe(z.number().int().positive()),
  // 夾帶「下一頁原文」作為銜接預告的最大字元數（clip）。
  OPENAI_SCRIPT_NEXT_CONTEXT_CHARS: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 600))
    .pipe(z.number().int().nonnegative()),
  // 夾帶「上一頁腳本」作為銜接參考的最大字元數（0 表示僅保留最後 2 句）。
  OPENAI_SCRIPT_PREV_CONTEXT_CHARS: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 400))
    .pipe(z.number().int().nonnegative()),
  OPENAI_REQUEST_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 60000))
    .pipe(z.number().int().positive()),
  OPENAI_MAX_RETRIES: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 3))
    .pipe(z.number().int().nonnegative()),
  OPENAI_MAX_PAGES: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 50))
    .pipe(z.number().int().positive()),
  OPENAI_IMAGE_MODEL: z.string().optional().default('gpt-image-2'),
  OPENAI_IMAGE_QUALITY: z
    .enum(['low', 'medium', 'high', 'auto'])
    .optional()
    .default('low'),
  OPENAI_IMAGE_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 60000))
    .pipe(z.number().int().positive()),
  OPENAI_IMAGE_TIMEOUT_MS_HIGH_QUALITY: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 120000))
    .pipe(z.number().int().positive()),
  // M4: OpenAI TTS settings
  OPENAI_TTS_MODEL: z
    .enum(['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'])
    .optional()
    .default('gpt-4o-mini-tts'),
  OPENAI_TTS_VOICE: z
    .enum(OPENAI_TTS_VOICES)
    .optional()
    .default('alloy'),
  OPENAI_TTS_FORMAT: z.enum(['mp3']).optional().default('mp3'),
  OPENAI_TTS_SPEED: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 1.0))
    .pipe(z.number().min(0.25).max(4.0)),
  TTS_CONCURRENCY: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 2))
    .pipe(z.number().int().positive()),
  NB_PREFIX: z.string().optional().default(''),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

function normalizeNbPrefix(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  const withLeadingSlash = v.startsWith('/') ? v : `/${v}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

export const config = {
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  storageRoot: path.resolve(repoRoot, env.STORAGE_ROOT),
  dbPath: path.resolve(repoRoot, env.DB_PATH),
  maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  maxUploadMb: env.MAX_UPLOAD_MB,
  repoRoot,
  // M2
  processConcurrency: env.PROCESS_CONCURRENCY,
  renderDpi: env.RENDER_DPI,
  popplerBinPath: env.POPPLER_BIN_PATH.trim(),
  // M3
  openaiApiKey: env.OPENAI_API_KEY.trim(),
  openaiLlmModel: env.OPENAI_LLM_MODEL,
  openaiScriptLanguage: env.OPENAI_SCRIPT_LANGUAGE,
  openaiScriptTargetChars: env.OPENAI_SCRIPT_TARGET_CHARS,
  openaiScriptStyle: env.OPENAI_SCRIPT_STYLE,
  openaiScriptUseImages: env.OPENAI_SCRIPT_USE_IMAGES,
  openaiScriptImageMaxWidth: env.OPENAI_SCRIPT_IMAGE_MAX_WIDTH,
  openaiScriptNextContextChars: env.OPENAI_SCRIPT_NEXT_CONTEXT_CHARS,
  openaiScriptPrevContextChars: env.OPENAI_SCRIPT_PREV_CONTEXT_CHARS,
  openaiRequestTimeoutMs: env.OPENAI_REQUEST_TIMEOUT_MS,
  openaiMaxRetries: env.OPENAI_MAX_RETRIES,
  openaiMaxPages: env.OPENAI_MAX_PAGES,
  openaiImageModel: env.OPENAI_IMAGE_MODEL,
  openaiImageQuality: env.OPENAI_IMAGE_QUALITY,
  openaiImageTimeoutMs: env.OPENAI_IMAGE_TIMEOUT_MS,
  openaiImageTimeoutMsHighQuality: env.OPENAI_IMAGE_TIMEOUT_MS_HIGH_QUALITY,
  // M4
  openaiTtsModel: env.OPENAI_TTS_MODEL,
  openaiTtsVoice: env.OPENAI_TTS_VOICE,
  openaiTtsFormat: env.OPENAI_TTS_FORMAT,
  openaiTtsSpeed: env.OPENAI_TTS_SPEED,
  ttsConcurrency: env.TTS_CONCURRENCY,
  nbPrefix: normalizeNbPrefix(env.NB_PREFIX),
} as const;

export type AppConfig = typeof config;
