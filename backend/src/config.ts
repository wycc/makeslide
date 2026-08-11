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

/**
 * Compute backends `audiocpp_cli --backend` accepts (services/audiocpp.ts). Declared here, next
 * to the env schema that validates them, so the settings loader and the engine wrapper cannot
 * drift apart — and so neither has to import the other.
 */
// Verified against `audiocpp_cli --help`, which accepts cpu|cuda|hip|rocm|vulkan|metal|best
// (rocm being an alias for hip, so it is not offered separately). 'best' lets audio.cpp itself
// pick — kept as an explicit choice rather than our default, because our own probe reports which
// backend it picked and why, while 'best' is silent about it.
export const AUDIOCPP_BACKENDS = ['cpu', 'cuda', 'vulkan', 'metal', 'hip', 'best'] as const;
export type AudioCppBackend = (typeof AUDIOCPP_BACKENDS)[number];

export function isAudioCppBackend(value: string): value is AudioCppBackend {
  return (AUDIOCPP_BACKENDS as readonly string[]).includes(value);
}

// Capture DB_PATH / STORAGE_ROOT as provided by the real process environment
// BEFORE dotenv loads the dev `.env` (which sets them to the dev DB/storage). In
// test mode below we prefer these shell-provided overrides, falling back to
// throwaway test paths — so the dev `.env` can't drag tests onto the real dev DB.
const shellDbPath = process.env.DB_PATH;
const shellStorageRoot = process.env.STORAGE_ROOT;

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
  // 每帳號設定（API key、模型、語音…）的存放根目錄。可覆寫是為了讓測試把帳號設定
  // 寫到拋棄式目錄——否則跑一次 E2E 就在開發者的 accounts/ 留下一堆測試帳號。
  ACCOUNTS_DIR: z.string().optional().default('./accounts'),
  MAX_UPLOAD_MB: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 50))
    .pipe(z.number().int().positive()),
  MAX_IMPORT_MB: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 2048))
    .pipe(z.number().int().positive()),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional()
    .default('info'),
  SUPPRESS_POLLING_REQUEST_LOGS: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  POLLING_REQUEST_LOG_PATHS: z.string().optional().default('/api/pdfs'),
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
  GERMINI_API_KEY: z.string().optional().default(''),
  GEMINI_API_KEY: z.string().optional().default(''),
  LLM_PROVIDER: z.enum(['openai', 'gemini', 'cgu-air', 'openrouter']).optional().default('openai'),
  // When true, makeslide's own AI calls may hand read-only presentation tools to the
  // LLM (function-calling) so it can look up more context. See docs/mcp-tools-in-ai-design.md.
  AI_MCP_TOOLS_ENABLED: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  TTS_PROVIDER: z.enum(['openai', 'gemini', 'openrouter', 'audiocpp']).optional().default('openai'),
  // ---------------------------------------------------------------------------
  // audio.cpp — local TTS (services/audiocpp.ts). No API key, no network, no
  // per-character cost; everything below describes where the engine lives on this
  // machine and which hardware it should run on.
  // ---------------------------------------------------------------------------
  /**
   * 'cli' spawns `audiocpp_cli` per segment (the mode where CPU/GPU is ours to choose, via
   * AUDIOCPP_TTS_BACKEND); 'server' posts to a running `audiocpp_server` (faster, model stays
   * resident, but that server's own config picks the backend). 'auto' = server when a base URL
   * is set, cli otherwise.
   */
  AUDIOCPP_TTS_MODE: z.enum(['auto', 'cli', 'server']).optional().default('auto'),
  AUDIOCPP_TTS_BASE_URL: z.string().optional().default(''),
  AUDIOCPP_TTS_BIN: z.string().optional().default('audiocpp_cli'),
  /** Model directory (cli mode) or the model id configured in server.json (server mode). */
  AUDIOCPP_TTS_MODEL: z.string().optional().default(''),
  /** Model family, e.g. `pocket_tts`, `qwen3_tts`. Only the CLI needs it. */
  AUDIOCPP_TTS_FAMILY: z.string().optional().default(''),
  /**
   * Compute backend for cli mode. 'auto' probes the machine (Metal on macOS, CUDA with an NVIDIA
   * driver, HIP with an AMD one, else CPU). An explicit value is passed straight through, and a
   * GPU backend that turns out to be unusable falls back to 'cpu' for that segment rather than
   * failing the page.
   */
  AUDIOCPP_TTS_BACKEND: z.enum(['auto', ...AUDIOCPP_BACKENDS]).optional().default('auto'),
  /** GPU ordinal on multi-GPU hosts; empty = let audio.cpp choose. */
  AUDIOCPP_TTS_DEVICE: z.string().optional().default(''),
  /** CPU threads; empty = audio.cpp's own default. */
  AUDIOCPP_TTS_THREADS: z.string().optional().default(''),
  /** Extra `--load-option key=value` pairs, comma-separated (e.g. `language=chinese`). */
  AUDIOCPP_TTS_LOAD_OPTIONS: z.string().optional().default(''),
  /**
   * Whether to prepend the language/persona steering block (services/ttsLanguagePrompt.ts) the
   * Gemini/OpenRouter paths rely on. **Off by default**: those are instruction-following speech
   * models, whereas most audio.cpp families are pure acoustic models that read every character
   * they are given — the steering line would simply be spoken aloud before the script.
   */
  AUDIOCPP_TTS_PROMPT_STEERING: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  /**
   * Per-segment ceiling. Generous compared to the hosted providers because a CPU-only run of a
   * large family is minutes of local compute, not a network round trip.
   */
  AUDIOCPP_TTS_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 600000))
    .pipe(z.number().int().positive()),
  // OpenRouter's OpenAI-compatible /audio/speech, used to reach Google's Gemini TTS.
  // Deliberately the same generation as GEMINI_TTS_MODEL below: the two providers are meant to
  // be interchangeable, and a voice name like 'Kore' does not sound the same across TTS model
  // generations — switching provider then audibly changed the narrator.
  OPENROUTER_TTS_MODEL: z.string().optional().default('google/gemini-2.5-flash-preview-tts'),
  /**
   * Send Gemini's `multiSpeakerVoiceConfig` on dual-host pages instead of synthesizing each
   * speaker's lines separately, so OpenRouter produces one continuous two-voice dialogue the
   * way the direct Gemini path does.
   *
   * It rides OpenRouter's documented `provider.options.<slug>` passthrough — but OpenRouter
   * documents that envelope only for `openai` and `azure`; the Google TTS parameters and the
   * slug below are not published anywhere. If the slug does not match, OpenRouter drops the
   * options **silently**, and the "Speaker 1:" labels this mode has to leave in the text get
   * read aloud. That is why this is a switch: turn it off and the per-segment path (two correct
   * voices, no labels spoken) comes straight back.
   */
  OPENROUTER_TTS_MULTI_SPEAKER: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  /** Provider slug the multi-speaker options are keyed under in `provider.options`. */
  OPENROUTER_TTS_PROVIDER_SLUG: z.string().optional().default('google-ai-studio'),
  OPENAI_LLM_MODEL: z.string().optional().default('gpt-4o-mini'),
  GEMINI_LLM_MODEL: z.string().optional().default('gemini-2.0-flash'),
  CGU_AIR_API_KEY: z.string().optional().default(''),
  CGU_AIR_BASE_URL: z.string().optional().default('https://air.cgu.edu.tw/cgullmapi/v1'),
  CGU_AIR_LLM_MODEL: z.string().optional().default('gpt-4o-mini'),
  OPENROUTER_API_KEY: z.string().optional().default(''),
  OPENROUTER_BASE_URL: z.string().optional().default('https://openrouter.ai/api/v1'),
  OPENROUTER_LLM_MODEL: z.string().optional().default('openai/gpt-4o-mini'),
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
    .transform((v) => (v ? Number(v) : 240000))
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
  /**
   * Weekly USD spending cap (LLM + TTS combined) per account when that account is using the
   * shared default provider key (i.e. it hasn't configured its own key — see
   * services/aiSettings.ts's accountHasOwnProviderKey / services/defaultSourceQuota.ts). Accounts
   * with their own key are never gated by this. Resets every Thursday (computed on read, not a
   * background job — see defaultSourceQuota.ts's weekStartIso).
   */
  DEFAULT_SOURCE_WEEKLY_QUOTA_USD: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 1))
    .pipe(z.number().nonnegative()),
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
  GEMINI_TTS_MODEL: z.string().optional().default('gemini-2.5-flash-preview-tts'),
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
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REDIRECT_URI: z.string().optional().default(''),
  GOOGLE_AUTH_ENABLED: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  AUTH_SESSION_SECRET: z.string().optional().default('makeslide-dev-session-secret'),
  HTTPS_KEY_PATH: z.string().optional().default(''),
  HTTPS_CERT_PATH: z.string().optional().default(''),
  NB_PREFIX: z.string().optional().default(''),
  // Jupyter notebook integration (docs/jupyter-integration-plan.md). Disabled by
  // default so the whole feature stays hidden until an operator opts in.
  JUPYTER_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  // Empty → frontend connects same-origin using NB_PREFIX (JupyterHub single-user
  // proxy). Set explicitly for a dev/desktop Jupyter server on another origin.
  JUPYTER_BASE_URL: z.string().optional().default(''),
  // Optional token for the explicit-URL dev/desktop mode. In production the
  // same-origin cookie is used instead and this stays empty (never shipped to the
  // frontend bundle; only handed out by the session-protected connection endpoint).
  JUPYTER_TOKEN: z.string().optional().default(''),
  // Same-origin backend reverse proxy: when set, the backend proxies `<NB_PREFIX><PROXY_PREFIX>/*`
  // (HTTP + WebSocket) to this local Jupyter server, e.g. http://127.0.0.1:8888. The frontend then
  // connects same-origin (no CORS/mixed-content, cookie-authenticated) and the internal Jupyter
  // never faces the network. Empty → no backend proxy.
  JUPYTER_PROXY_TARGET: z.string().optional().default(''),
  // Path prefix the proxy mounts under (kept separate from NB_PREFIX, which is MakeSlide's own
  // base, so Jupyter's API doesn't collide with MakeSlide's routes/static). The Jupyter server
  // must run with ServerApp.base_url = `<NB_PREFIX><PROXY_PREFIX>`.
  JUPYTER_PROXY_PREFIX: z.string().optional().default('/jupyter'),
  // docs/jupyter-kubeflow-plan.md: which connection strategy `/api/jupyter/connection`
  // uses. `proxy`/`url` are the existing single-server modes above; `kubeflow` routes
  // each user to their own Kubeflow Notebook CR instead (per-user isolation).
  JUPYTER_MODE: z.enum(['proxy', 'url', 'kubeflow']).optional().default('proxy'),
  // Header Istio/authservice injects with the authenticated Kubeflow user identity.
  KUBEFLOW_USERID_HEADER: z.string().optional().default('kubeflow-userid'),
  // Template for deriving a user's Kubeflow profile namespace from their MakeSlide
  // session email/account. `{user}` is replaced with the local-part of the email.
  KUBEFLOW_DEFAULT_NAMESPACE_TEMPLATE: z.string().optional().default('{user}'),
  // Notebook CR name prefix used for runtime discovery; the suffix after this prefix
  // is the runtime type shown in the UI (e.g. `makeslide-jupyter-gpu-a100` → `gpu-a100`).
  KUBEFLOW_NOTEBOOK_PREFIX: z.string().optional().default('makeslide-jupyter-'),
  // JupyterLab image used when auto-creating the zero-config `makeslide-jupyter-cpu`
  // notebook (docs/jupyter-kubeflow-plan.md §3.5).
  KUBEFLOW_DEFAULT_RUNTIME_IMAGE: z.string().optional().default(''),
  // requests/limits for the auto-created CPU default notebook, as `key=value` pairs
  // separated by commas (e.g. `cpu=1,memory=2Gi`).
  KUBEFLOW_DEFAULT_RUNTIME_RESOURCES: z.string().optional().default('cpu=1,memory=2Gi'),
});

// Test isolation: when running under the test runner (MAKESLIDE_TEST=1, set by the
// backend `test` npm script and scripts/run-tests.sh), redirect the database and
// storage root to throwaway locations under the gitignored `data/` dir instead of
// the real dev DB/storage. This prevents tests — which seed rows directly via
// `../src/db` and write fixtures under `config.storageRoot`, without cleaning up —
// from polluting the running dev instance (a stray `processing` PDF row otherwise
// makes the dev worker loop on a pipeline task whose storage dir never existed).
// A DB_PATH/STORAGE_ROOT exported in the real shell still wins (see shellDbPath
// above), so CI or a caller can override; the dev `.env` values are ignored here.
if (process.env.MAKESLIDE_TEST === '1' || process.env.NODE_ENV === 'test') {
  process.env.DB_PATH = shellDbPath ?? './data/test.db';
  process.env.STORAGE_ROOT = shellStorageRoot ?? './data/test-storage';
}

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

/** `''` (the "let the engine decide" value for audio.cpp's device/threads) parses to null, not 0. */
function parseOptionalInt(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function normalizeNbPrefix(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  const withLeadingSlash = v.startsWith('/') ? v : `/${v}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

export const config = {
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  suppressPollingRequestLogs: env.SUPPRESS_POLLING_REQUEST_LOGS,
  pollingRequestLogPaths: env.POLLING_REQUEST_LOG_PATHS.split(',')
    .map((v) => v.trim())
    .filter(Boolean),
  storageRoot: path.resolve(repoRoot, env.STORAGE_ROOT),
  accountsDir: path.resolve(repoRoot, env.ACCOUNTS_DIR),
  dbPath: path.resolve(repoRoot, env.DB_PATH),
  maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  maxUploadMb: env.MAX_UPLOAD_MB,
  maxImportBytes: env.MAX_IMPORT_MB * 1024 * 1024,
  maxImportMb: env.MAX_IMPORT_MB,
  repoRoot,
  // M2
  processConcurrency: env.PROCESS_CONCURRENCY,
  renderDpi: env.RENDER_DPI,
  popplerBinPath: env.POPPLER_BIN_PATH.trim(),
  // M3
  openaiApiKey: env.OPENAI_API_KEY.trim(),
  geminiApiKey: (env.GERMINI_API_KEY || env.GEMINI_API_KEY).trim(),
  llmProvider: env.LLM_PROVIDER,
  aiMcpToolsEnabled: env.AI_MCP_TOOLS_ENABLED,
  ttsProvider: env.TTS_PROVIDER,
  openaiLlmModel: env.OPENAI_LLM_MODEL,
  geminiLlmModel: env.GEMINI_LLM_MODEL,
  cguAirApiKey: env.CGU_AIR_API_KEY.trim(),
  cguAirBaseUrl: env.CGU_AIR_BASE_URL.trim(),
  cguAirLlmModel: env.CGU_AIR_LLM_MODEL,
  openrouterApiKey: env.OPENROUTER_API_KEY.trim(),
  openrouterBaseUrl: env.OPENROUTER_BASE_URL.trim(),
  openrouterLlmModel: env.OPENROUTER_LLM_MODEL,
  openrouterTtsModel: env.OPENROUTER_TTS_MODEL,
  openrouterTtsMultiSpeaker: env.OPENROUTER_TTS_MULTI_SPEAKER,
  openrouterTtsProviderSlug: env.OPENROUTER_TTS_PROVIDER_SLUG,
  audiocppTtsMode: env.AUDIOCPP_TTS_MODE,
  audiocppTtsBaseUrl: env.AUDIOCPP_TTS_BASE_URL.trim(),
  audiocppTtsBinPath: env.AUDIOCPP_TTS_BIN.trim() || 'audiocpp_cli',
  audiocppTtsModel: env.AUDIOCPP_TTS_MODEL.trim(),
  audiocppTtsFamily: env.AUDIOCPP_TTS_FAMILY.trim(),
  audiocppTtsBackend: env.AUDIOCPP_TTS_BACKEND,
  audiocppTtsDevice: parseOptionalInt(env.AUDIOCPP_TTS_DEVICE),
  audiocppTtsThreads: parseOptionalInt(env.AUDIOCPP_TTS_THREADS),
  audiocppTtsLoadOptions: env.AUDIOCPP_TTS_LOAD_OPTIONS.split(',')
    .map((v) => v.trim())
    .filter(Boolean),
  audiocppTtsPromptSteering: env.AUDIOCPP_TTS_PROMPT_STEERING,
  audiocppTtsTimeoutMs: env.AUDIOCPP_TTS_TIMEOUT_MS,
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
  defaultSourceWeeklyQuotaUsd: env.DEFAULT_SOURCE_WEEKLY_QUOTA_USD,
  openaiImageModel: env.OPENAI_IMAGE_MODEL,
  openaiImageQuality: env.OPENAI_IMAGE_QUALITY,
  openaiImageTimeoutMs: env.OPENAI_IMAGE_TIMEOUT_MS,
  openaiImageTimeoutMsHighQuality: env.OPENAI_IMAGE_TIMEOUT_MS_HIGH_QUALITY,
  // M4
  openaiTtsModel: env.OPENAI_TTS_MODEL,
  geminiTtsModel: env.GEMINI_TTS_MODEL,
  openaiTtsVoice: env.OPENAI_TTS_VOICE,
  openaiTtsFormat: env.OPENAI_TTS_FORMAT,
  openaiTtsSpeed: env.OPENAI_TTS_SPEED,
  ttsConcurrency: env.TTS_CONCURRENCY,
  googleClientId: env.GOOGLE_CLIENT_ID.trim(),
  googleClientSecret: env.GOOGLE_CLIENT_SECRET.trim(),
  googleRedirectUri: env.GOOGLE_REDIRECT_URI.trim(),
  googleAuthEnabled: env.GOOGLE_AUTH_ENABLED,
  authSessionSecret: env.AUTH_SESSION_SECRET,
  httpsKeyPath: env.HTTPS_KEY_PATH.trim(),
  httpsCertPath: env.HTTPS_CERT_PATH.trim(),
  nbPrefix: normalizeNbPrefix(env.NB_PREFIX),
  jupyterEnabled: env.JUPYTER_ENABLED,
  jupyterBaseUrl: env.JUPYTER_BASE_URL.trim(),
  jupyterToken: env.JUPYTER_TOKEN.trim(),
  jupyterProxyTarget: env.JUPYTER_PROXY_TARGET.trim(),
  jupyterProxyPrefix: env.JUPYTER_PROXY_PREFIX.trim(),
  jupyterMode: env.JUPYTER_MODE,
  kubeflowUserIdHeader: env.KUBEFLOW_USERID_HEADER.trim().toLowerCase(),
  kubeflowDefaultNamespaceTemplate: env.KUBEFLOW_DEFAULT_NAMESPACE_TEMPLATE.trim(),
  kubeflowNotebookPrefix: env.KUBEFLOW_NOTEBOOK_PREFIX.trim(),
  kubeflowDefaultRuntimeImage: env.KUBEFLOW_DEFAULT_RUNTIME_IMAGE.trim(),
  kubeflowDefaultRuntimeResources: env.KUBEFLOW_DEFAULT_RUNTIME_RESOURCES.trim(),
} as const;

export type AppConfig = typeof config;
