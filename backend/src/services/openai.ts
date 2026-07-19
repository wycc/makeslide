import OpenAI, { APIError } from 'openai';
import { toFile } from 'openai/uploads';
import { brotliDecompress as brotliDecompressRaw } from 'node:zlib';
import { promisify } from 'node:util';

const brotliDecompressAsync = promisify(brotliDecompressRaw);
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  toOpenAiTools,
  executeAiTool,
  type AiTool,
  type AiToolContext,
} from './aiTools';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../logger';
import { callGeminiJson, callGeminiTextStream } from './gemini';
import { getRuntimeAiSettings, accountHasOwnProviderKey, type LlmProvider, type RuntimeAiSettings } from './aiSettings';
import { currentAccountId, sanitizeAccountId } from './accountContext';
import { appendLlmRequestLog, appendLlmResponseLog, getStickyLlmProvider, setStickyLlmProvider, estimateLlmCostUsd } from './llmUsage';
import { redactLogObject, redactTextForLog } from './logSanitizer';
import { ApiKeyMissingError, isApiKeyMissingError } from './apiKeyErrors';
import {
  hasDefaultSourceQuotaRemaining,
  getAccountWeeklyUsage,
  recordDefaultSourceCost,
  DefaultSourceQuotaExceededError,
  isDefaultSourceQuotaExceededError,
  defaultSourceQuotaExceededMessage,
} from './defaultSourceQuota';

type OpenAiCompatibleProvider = Exclude<LlmProvider, 'gemini'>;

interface AccountOpenAiState {
  client: OpenAI | null;
  apiKeyOverride: string | null;
  baseUrlOverride: string | null;
}

// 每個帳號各自快取自己的 OpenAI client / API key 覆寫值，避免使用者 A 變更
// API key 時意外影響到使用者 B 正在進行中或稍後才執行的請求。
const accountStates = new Map<string, AccountOpenAiState>();

function getAccountState(accountId: string, provider: OpenAiCompatibleProvider = 'openai'): AccountOpenAiState {
  const safeAccountId = `${sanitizeAccountId(accountId)}:${provider}`;
  let state = accountStates.get(safeAccountId);
  if (!state) {
    state = { client: null, apiKeyOverride: null, baseUrlOverride: null };
    accountStates.set(safeAccountId, state);
  }
  return state;
}

// 僅供測試使用：強制所有帳號回傳同一顆 stub client。
let testClientOverride: OpenAI | null | undefined;

function extractImageFileName(url: string): string {
  if (!url) return 'unknown-image';
  if (url.startsWith('data:')) return 'inline-image.jpg';
  try {
    const u = new URL(url);
    const raw = u.pathname.split('/').pop() ?? '';
    return raw || 'unknown-image';
  } catch {
    const raw = url.split(/[\\/]/).pop() ?? '';
    return raw || 'unknown-image';
  }
}

function sanitizeMessagesForLog(messages: ChatCompletionMessageParam[]): unknown[] {
  return messages.map((m) => {
    const msg = m as { role?: unknown; content?: unknown };
    const role = typeof msg.role === 'string' ? msg.role : 'unknown';
    if (!Array.isArray(msg.content)) {
      return { role, content: msg.content ?? null };
    }
    const content = msg.content.map((part) => {
      const p = part as { type?: unknown; text?: unknown; image_url?: { url?: string; detail?: unknown } };
      if (p.type === 'text') {
        return { type: 'text', text: typeof p.text === 'string' ? p.text : '' };
      }
      if (p.type === 'image_url') {
        const file = extractImageFileName(p.image_url?.url ?? '');
        return {
          type: 'image_url',
          image_url: { file, detail: p.image_url?.detail ?? 'auto' },
        };
      }
      return { type: typeof p.type === 'string' ? p.type : 'unknown' };
    });
    return { role, content };
  });
}

function summarizeMessagesForRuntimeLog(messages: ChatCompletionMessageParam[]): unknown[] {
  return messages.map((m) => {
    const msg = m as { role?: unknown; content?: unknown };
    const role = typeof msg.role === 'string' ? msg.role : 'unknown';
    if (typeof msg.content === 'string') {
      return { role, content: redactTextForLog(msg.content) };
    }
    if (!Array.isArray(msg.content)) return { role, contentType: typeof msg.content };
    return {
      role,
      content: msg.content.map((part) => {
        const p = part as { type?: unknown; text?: unknown; image_url?: { url?: string; detail?: unknown } };
        if (p.type === 'text') return { type: 'text', text: redactTextForLog(typeof p.text === 'string' ? p.text : '') };
        if (p.type === 'image_url') {
          return {
            type: 'image_url',
            image_url: {
              file: extractImageFileName(p.image_url?.url ?? ''),
              detail: p.image_url?.detail ?? 'auto',
            },
          };
        }
        return { type: typeof p.type === 'string' ? p.type : 'unknown' };
      }),
    };
  });
}

/** 取得目前情境的 pdf_id/run_id（若有），供 log 寫入時附帶 pipeline run 關聯資訊。 */

/**
 * Lazily instantiated OpenAI client. Throws a clear error if the API key is
 * missing so the server can still start (and serve M2 endpoints) when the
 * operator has not configured M3 yet.
 */
export function getOpenAIClient(accountId: string = currentAccountId(), provider: OpenAiCompatibleProvider = 'openai'): OpenAI {
  if (testClientOverride !== undefined) return testClientOverride as OpenAI;

  const state = getAccountState(accountId, provider);
  if (state.client) return state.client;

  const settings = getRuntimeAiSettings(accountId);
  const apiKey = (state.apiKeyOverride ?? providerApiKey(settings, provider) ?? '').trim();
  if (!apiKey) {
    throw new ApiKeyMissingError(providerLabel(provider), `${providerEnvPrefix(provider)}_API_KEY is not set — cannot call ${providerLabel(provider)}. Update settings and retry.`);
  }
  const baseURL = (state.baseUrlOverride ?? providerBaseUrl(settings, provider) ?? '').trim() || undefined;

  const debugFetch: typeof globalThis.fetch = async (url, init) => {
    const resp = await globalThis.fetch(url as Parameters<typeof globalThis.fetch>[0], init);

    // Streaming responses (SSE) MUST pass through untouched. Cloning + draining the
    // body below (`await clone.arrayBuffer()`) reads the entire stream to completion
    // before returning `resp` to the OpenAI SDK, which collapses token-by-token
    // streaming into one burst at the end (defeats `/ask` and animation streaming).
    // For these we only log headers and hand the live stream straight back.
    const contentType = resp.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      logger.debug(
        redactLogObject({ status: resp.status, url: url.toString(), contentType }),
        'OpenAI streaming response (passthrough, body not buffered)',
      );
      return resp;
    }

    const clone = resp.clone();
    const buf = Buffer.from(await clone.arrayBuffer());

    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => { respHeaders[k] = v; });
    logger.debug(
      redactLogObject({
        status: resp.status,
        url: url.toString(),
        headers: respHeaders,
        bytes: buf.byteLength,
        bodyPreview: buf.toString('utf8', 0, Math.min(buf.byteLength, 256)),
      }),
      'OpenAI raw response received',
    );

    // Auto-fix: if server sent brotli without Content-Encoding header, decompress manually
    const contentEncoding = resp.headers.get('content-encoding') ?? '';
    if (contentEncoding.includes('br') || (!contentEncoding && buf[0] === 0x1b)) {
      try {
        const decompressed = await brotliDecompressAsync(buf);
        logger.debug(
          redactLogObject({ bytes: decompressed.byteLength, bodyPreview: decompressed.toString('utf8', 0, Math.min(decompressed.byteLength, 256)) }),
          'OpenAI brotli response decompressed',
        );
        const fixedHeaders = new Headers(resp.headers);
        fixedHeaders.delete('content-encoding');
        fixedHeaders.delete('content-length');
        return new Response(decompressed, {
          status: resp.status,
          statusText: resp.statusText,
          headers: fixedHeaders,
        });
      } catch (e) {
        logger.warn({ error: e instanceof Error ? e.message : String(e) }, 'OpenAI brotli decompress failed');
      }
    }

    return resp;
  };

  state.client = new OpenAI({
    apiKey,
    baseURL,
    fetch: debugFetch,
    timeout: config.openaiRequestTimeoutMs,
    maxRetries: config.openaiMaxRetries,
  });
  logger.info(
    {
      accountId: sanitizeAccountId(accountId),
      provider,
      model: providerModel(settings, provider),
      baseURL: baseURL ?? '(default)',
      timeoutMs: config.openaiRequestTimeoutMs,
      maxRetries: config.openaiMaxRetries,
      maxPages: config.openaiMaxPages,
    },
    'OpenAI client initialised',
  );
  return state.client;
}

export function setOpenAIApiKeyRuntime(accountId: string, apiKey: string): void {
  const state = getAccountState(accountId, 'openai');
  state.apiKeyOverride = apiKey.trim();
  state.client = null;
}

export function setOpenAIBaseUrlRuntime(accountId: string, baseUrl: string): void {
  const state = getAccountState(accountId, 'openai');
  state.baseUrlOverride = baseUrl.trim() || null;
  state.client = null;
}

/**
 * Forces the next getOpenAIClient() call for this account/provider to build a fresh client.
 * Unlike 'openai' (which has its own apiKeyOverride/baseUrlOverride setters above that also
 * clear the cache), 'cgu-air' and 'openrouter' read their key/baseURL straight from
 * getRuntimeAiSettings() with no override layer — admin.ts should call this whenever it updates
 * either provider's settings, otherwise an account that already cached a client keeps using the
 * old credentials until the server restarts.
 */
export function invalidateOpenAIClientCache(accountId: string, provider: OpenAiCompatibleProvider): void {
  getAccountState(accountId, provider).client = null;
}

export function setOpenAIClientForTest(client: OpenAI | null): void {
  testClientOverride = client;
}

function providerApiKey(settings: ReturnType<typeof getRuntimeAiSettings>, provider: OpenAiCompatibleProvider): string {
  if (provider === 'cgu-air') return settings.cguAirApiKey;
  if (provider === 'openrouter') return settings.openrouterApiKey;
  return settings.openaiApiKey;
}

function providerBaseUrl(settings: ReturnType<typeof getRuntimeAiSettings>, provider: OpenAiCompatibleProvider): string {
  if (provider === 'cgu-air') return settings.cguAirBaseUrl;
  if (provider === 'openrouter') return settings.openrouterBaseUrl;
  return settings.openaiBaseUrl;
}

function providerModel(settings: ReturnType<typeof getRuntimeAiSettings>, provider: OpenAiCompatibleProvider): string {
  if (provider === 'cgu-air') return settings.cguAirLlmModel;
  if (provider === 'openrouter') return settings.openrouterLlmModel;
  return settings.openaiLlmModel;
}

function providerEnvPrefix(provider: OpenAiCompatibleProvider): string {
  if (provider === 'cgu-air') return 'CGU_AIR';
  if (provider === 'openrouter') return 'OPENROUTER';
  return 'OPENAI';
}

function providerImageModel(
  settings: ReturnType<typeof getRuntimeAiSettings>,
  provider: OpenAiCompatibleProvider,
): string {
  // Non-OpenAI providers need their own image model name; fall back to the OpenAI image
  // model when unset (lets it work out of the box if the provider happens to accept it).
  if (provider === 'cgu-air') return settings.cguAirImageModel.trim() || config.openaiImageModel;
  if (provider === 'openrouter') return settings.openrouterImageModel.trim() || config.openaiImageModel;
  return config.openaiImageModel;
}

export interface ImageGenerationTarget {
  client: OpenAI;
  /** Image model name to send for this account's selected image provider. */
  model: string;
  provider: OpenAiCompatibleProvider;
}

/**
 * Resolve which OpenAI-compatible client + image model to use for image generation.
 *
 * Image generation uses the OpenAI Images API shape (`images.generate` / `images.edit`).
 * Historically every image call hard-coded the default OpenAI client + `config.openaiImageModel`,
 * so an account that selected e.g. CGU Air for its LLM still had its images sent to OpenAI —
 * and failed with a 401 when no valid OpenAI key was configured. This routes images through
 * whichever OpenAI-compatible provider the account picked (so CGU Air for text also means
 * CGU Air for images, using that provider's key/base URL), falling back to OpenAI for
 * providers that don't speak the Images API (Gemini).
 *
 * Best-effort: whether the selected provider actually implements the Images API is up to that
 * provider; if it doesn't, the call will surface that provider's error instead of a misleading
 * OpenAI 401.
 *
 * Uses effectiveLlmProvider (sticky-aware) rather than the raw account setting, so once a run has
 * failed over its LLM/TTS calls to a secondary provider (see setStickyLlmProvider), image calls
 * resolved afterward automatically follow — and, symmetrically, if image generation is the first
 * thing to hit a permanent error in a run, resolveImageProviderFailover below can trigger the same
 * sticky failover for the LLM/TTS calls that come after it.
 */
export function getImageClient(accountId: string = currentAccountId()): ImageGenerationTarget {
  const settings = getRuntimeAiSettings(accountId);
  const selected = effectiveLlmProvider(settings);
  const provider: OpenAiCompatibleProvider = selected === 'gemini' ? 'openai' : selected;
  return {
    client: getOpenAIClient(accountId, provider),
    model: providerImageModel(settings, provider),
    provider,
  };
}

function providerLabel(provider: OpenAiCompatibleProvider): string {
  if (provider === 'cgu-air') return 'CGU Air';
  if (provider === 'openrouter') return 'OpenRouter';
  return 'OpenAI';
}

// 目前帳號設定的 LLM provider（gemini 不支援 OpenAI 相容音訊轉錄，退回 openai）。
// 供語音轉文字選用與 chat 相同的 OpenAI 相容端點（例如 cgu-air），這樣只設了該 provider 的
// 金鑰也能用 Whisper STT。
export function resolveTranscriptionProvider(accountId: string = currentAccountId()): OpenAiCompatibleProvider {
  const selected = getRuntimeAiSettings(accountId).llmProvider;
  return selected === 'gemini' ? 'openai' : selected;
}

export async function transcribeAudioBuffer(
  audio: Buffer,
  filename: string,
  mimeType: string,
  provider: OpenAiCompatibleProvider = 'openai',
): Promise<string> {
  const client = getOpenAIClient(currentAccountId(), provider);
  const file = await toFile(audio, filename, { type: mimeType });
  const startedAt = Date.now();
  const transcription = await client.audio.transcriptions.create({
    file,
    model: 'whisper-1',
  });
  logger.info(
    { filename, mimeType, bytes: audio.length, latencyMs: Date.now() - startedAt },
    'OpenAI audio transcription completed',
  );
  return transcription.text.trim();
}

export interface TranscribedWordTimestamp {
  word: string;
  start: number;
  end: number;
}

/**
 * Transcribes audio with Whisper's per-word timestamps (`response_format: 'verbose_json'`,
 * `timestamp_granularities: ['word']`), used by the "Whisper 精準對齊" subtitle sync mode to
 * ground each sentence's playback time in what was actually spoken instead of a character-count
 * estimate. Costs more latency than the plain-text transcription above (word timestamps aren't
 * free), so this is only called when that mode is explicitly enabled.
 */
export async function transcribeAudioBufferWithWordTimestamps(
  audio: Buffer,
  filename: string,
  mimeType: string,
  provider: OpenAiCompatibleProvider = 'openai',
): Promise<TranscribedWordTimestamp[]> {
  const client = getOpenAIClient(currentAccountId(), provider);
  const file = await toFile(audio, filename, { type: mimeType });
  const startedAt = Date.now();
  const transcription = await client.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
  });
  const words = transcription.words ?? [];
  logger.info(
    { filename, mimeType, bytes: audio.length, words: words.length, latencyMs: Date.now() - startedAt },
    'OpenAI audio transcription (word timestamps) completed',
  );
  return words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatJSONResult<T> {
  data: T;
  usage: TokenUsage;
  latencyMs: number;
  rawContent: string;
}

export interface ChatJSONParams<T> {
  model?: string;
  messages: ChatCompletionMessageParam[];
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Enforce a sensible cap; defaults to 800 which is plenty for a ~150-char script. */
  maxTokens?: number;
  temperature?: number;
  /** Optional label for logs to locate slow / failing calls. */
  label?: string;
  /** Read-only tools to offer the model (function-calling). Requires `toolContext`. */
  tools?: AiTool[];
  /** Account/deck scope for tool execution (see aiTools.ts). */
  toolContext?: AiToolContext;
}

function supportsMaxCompletionTokens(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.startsWith('gpt-5.5');
}

function supportsTemperature(model: string): boolean {
  const normalized = model.toLowerCase();
  return !normalized.startsWith('gpt-5.5');
}

function isRetryable(err: unknown): boolean {
  if (err instanceof APIError) {
    if (err.status === 429) return true;
    if (err.status !== undefined && err.status >= 500 && err.status < 600) return true;
  }
  return false;
}

const PERMANENT_PROVIDER_ERROR_PATTERN = /HTTP\s*40[13]\b|quota|insufficient.?quota|billing/i;

/**
 * Distinguishes errors that mean "this provider won't work again for the rest of this run" (bad/
 * missing key, suspended account, spending cap hit, this account's shared default-source weekly
 * quota exhausted) from transient ones (429 rate limit, 5xx — already retried by the SDK /
 * logged by isRetryable). Used by callChatJSON/streamChatText to decide whether to fail over to
 * the account's configured secondary provider instead of just surfacing the error. Gemini errors
 * (gemini.ts) are plain `Error`s with an `HTTP <status>` message rather than APIError, hence the
 * message-pattern fallback below.
 *
 * Exported for unit testing only; call sites within this file use it directly.
 */
export function isPermanentProviderError(err: unknown): boolean {
  if (isApiKeyMissingError(err)) return true;
  if (isDefaultSourceQuotaExceededError(err)) return true;
  if (err instanceof APIError) {
    if (err.status === 401 || err.status === 403) return true;
    // Quota/billing exhaustion is reported under a wide range of statuses depending on the
    // provider/gateway (429 "insufficient_quota", 400 "Billing hard limit has been reached", …) —
    // rather than gate this on a specific status, check the structured code/type plus the message
    // for every status once 401/403 are already handled above.
    const code = typeof err.code === 'string' ? err.code : '';
    const errType = typeof (err as { type?: unknown }).type === 'string' ? String((err as { type?: unknown }).type) : '';
    return /quota|insufficient|billing/i.test(code)
      || /quota|insufficient|billing/i.test(errType)
      || PERMANENT_PROVIDER_ERROR_PATTERN.test(err.message ?? '');
  }
  return err instanceof Error && PERMANENT_PROVIDER_ERROR_PATTERN.test(err.message);
}

/**
 * Which LLM provider a call should actually use: the run's sticky failover choice if this run
 * already failed over (see setStickyLlmProvider), otherwise the account's configured primary.
 */
function effectiveLlmProvider(runtime: RuntimeAiSettings): LlmProvider {
  return getStickyLlmProvider() ?? runtime.llmProvider;
}

/**
 * Whether — and to what provider — image generation (renderTextPagesWithLlm.ts, page-operations.ts,
 * regenerate.ts) should fail over after `err`, using the same sticky mechanism/config as
 * callChatJSON/streamChatText (getImageClient is routed by the same llmProvider/secondaryLlmProvider
 * setting). Image generation has its own retry loop per call site for transient errors — callers
 * should only reach for this once that loop is about to give up. Returns null when there's nothing
 * to fail over to (no secondary configured, already on it, or `err` isn't a permanent provider
 * error), in which case the caller should just propagate the original error.
 */
export function resolveImageProviderFailover(accountId: string, err: unknown): LlmProvider | null {
  if (!isPermanentProviderError(err)) return null;
  const runtime = getRuntimeAiSettings(accountId);
  const secondary = runtime.secondaryLlmProvider;
  const current = effectiveLlmProvider(runtime);
  if (!secondary || secondary === current || getStickyLlmProvider() === secondary) return null;
  return secondary;
}

/**
 * Throws if this call would use the shared server-wide default key for `provider` (i.e. the
 * account never configured its own — see aiSettings.ts's accountHasOwnProviderKey) AND this
 * account has already spent its weekly default-source quota. Accounts with their own key for
 * `provider` are never gated. Called per attempted provider (including a failover retry with the
 * secondary provider), so an account whose secondary provider uses its own key still gets through
 * even after its shared-source quota is exhausted on the primary.
 */
function assertDefaultSourceQuotaAvailable(accountId: string, provider: LlmProvider): void {
  if (accountHasOwnProviderKey(accountId, provider)) return;
  const usage = getAccountWeeklyUsage(accountId);
  if (usage.remainingUsd <= 0) {
    throw new DefaultSourceQuotaExceededError(defaultSourceQuotaExceededMessage(usage));
  }
}

/** Records this call's estimated cost against the account's weekly quota, only when it actually used the shared default key for `provider` (own-key usage is never metered). */
function recordDefaultSourceLlmUsage(accountId: string, provider: LlmProvider, model: string, usage: TokenUsage): void {
  if (accountHasOwnProviderKey(accountId, provider)) return;
  const cost = estimateLlmCostUsd(model, usage);
  if (cost !== undefined) recordDefaultSourceCost(accountId, cost);
}

// ── AI tool-calling (function-calling) support ──────────────────────────────────
// See docs/mcp-tools-in-ai-design.md. When a call site passes read-only tools and
// the feature flag is on (OpenAI-compatible providers only), the model may call
// tools to fetch more presentation context before answering.

const MAX_TOOL_ROUNDS = 5;

/**
 * A `role:'tool'` message can only carry text, so when a tool returns images we
 * attach them as a follow-up vision `user` message the model can actually see.
 */
function appendToolImages(messages: ChatCompletionMessageParam[], images: string[] | undefined): void {
  if (!images || images.length === 0) return;
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: '（以下為上一個工具附上的頁面圖片，請直接依圖片內容作答。）' },
      ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ],
  });
}

interface ResolvedToolset {
  aiTools: AiTool[];
  openAiTools: ReturnType<typeof toOpenAiTools>;
  toolContext: AiToolContext;
}

/** Decide whether tools should be offered for this call (flag on, provider ok, tools given). */
function resolveToolset(
  provider: LlmProvider,
  tools: AiTool[] | undefined,
  toolContext: AiToolContext | undefined,
  label?: string,
): ResolvedToolset | null {
  if (!tools || tools.length === 0) return null;
  if (!config.aiMcpToolsEnabled) return null;
  if (!toolContext) return null;
  if (provider === 'gemini') {
    // Phase 1 supports OpenAI-compatible providers only; degrade gracefully.
    logger.debug({ label }, 'AI tools requested but provider is gemini — skipping tools (Phase 1)');
    return null;
  }
  return { aiTools: tools, openAiTools: toOpenAiTools(tools), toolContext };
}

/**
 * Runs non-streaming tool-calling rounds, mutating `messages` in place (appending
 * the assistant tool_call turns and each tool result). Returns the final completion
 * whose message no longer requests tools (the model's actual answer). `createOnce`
 * performs a single chat.completions.create with the given tool_choice.
 */
async function runToolRounds(opts: {
  messages: ChatCompletionMessageParam[];
  toolset: ResolvedToolset;
  label?: string;
  createOnce: (toolChoice: 'auto' | 'none') => Promise<ChatCompletion>;
}): Promise<ChatCompletion> {
  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    const completion = await opts.createOnce(round < MAX_TOOL_ROUNDS ? 'auto' : 'none');
    const msg = completion.choices[0]?.message;
    const toolCalls = msg?.tool_calls ?? [];
    if (!toolCalls.length) return completion;
    opts.messages.push({ role: 'assistant', content: msg?.content ?? '', tool_calls: toolCalls });
    for (const tc of toolCalls) {
      if (tc.type !== 'function') continue;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>; } catch { args = {}; }
      const result = await executeAiTool(opts.toolset.aiTools, tc.function.name, args, opts.toolset.toolContext);
      logger.debug({ label: opts.label, tool: tc.function.name, round, images: result.images?.length ?? 0 }, 'AI tool executed');
      opts.messages.push({ role: 'tool', tool_call_id: tc.id, content: result.text });
      appendToolImages(opts.messages, result.images);
    }
  }
  return opts.createOnce('none');
}

/**
 * Call Chat Completions with `response_format=json_object` and validate the
 * returned JSON against `schema`. Performs one manual retry on schema-
 * validation failures (separate from the SDK's transport-level retries).
 *
 * Fails over to the account's configured secondary LLM provider (if any) when the primary
 * provider fails permanently (see isPermanentProviderError) — e.g. a suspended key or a
 * quota/billing cap hit mid-run — and keeps using it for the rest of this run (see
 * setStickyLlmProvider). A transient error (rate limit, 5xx) is not failed over; those are
 * already retried by the SDK / surfaced as-is.
 */
export async function callChatJSON<T>(
  params: ChatJSONParams<T>,
): Promise<ChatJSONResult<T>> {
  const runtime = getRuntimeAiSettings();
  const provider = effectiveLlmProvider(runtime);
  try {
    return await callChatJSONWithProvider(params, runtime, provider);
  } catch (err) {
    const secondary = runtime.secondaryLlmProvider;
    if (secondary && secondary !== provider && getStickyLlmProvider() !== secondary && isPermanentProviderError(err)) {
      logger.warn(
        { label: params.label, from: provider, to: secondary, err: err instanceof Error ? err.message : String(err) },
        'LLM primary provider failed permanently — failing over to secondary provider for the rest of this run',
      );
      setStickyLlmProvider(secondary);
      return await callChatJSONWithProvider(params, runtime, secondary);
    }
    throw err;
  }
}

async function callChatJSONWithProvider<T>(
  params: ChatJSONParams<T>,
  runtime: RuntimeAiSettings,
  provider: LlmProvider,
): Promise<ChatJSONResult<T>> {
  const accountId = currentAccountId();
  assertDefaultSourceQuotaAvailable(accountId, provider);

  if (provider === 'gemini') {
    const model = params.model ?? runtime.geminiLlmModel;
    const startedAt = Date.now();
    const result = await callGeminiJson({
      model,
      messages: params.messages,
      schema: params.schema,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });
    recordDefaultSourceLlmUsage(accountId, provider, model, result.usage);
    return {
      data: result.data,
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
      rawContent: result.rawContent,
    };
  }
  const client = getOpenAIClient(currentAccountId(), provider);
  const model = params.model ?? providerModel(runtime, provider);
  const toolset = resolveToolset(provider, params.tools, params.toolContext, params.label);
  const maxAttempts = 2; // parse/validate retries (on top of SDK retries)
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    let completion: ChatCompletion;
    const requestedMaxTokens = params.maxTokens ?? 800;
    // Keep generation ceilings generous to avoid finish_reason=length truncation.
    // Content length constraints should be enforced primarily by prompt/schema.
    const generousBaseMaxTokens = Math.max(requestedMaxTokens, 4000);
    const maxTokens = attempt === 1
      ? generousBaseMaxTokens
      : Math.min(16000, Math.max(generousBaseMaxTokens, Math.ceil(generousBaseMaxTokens * 1.8)));
    const temperature = params.temperature ?? 0.6;
    const tokenLimitField = supportsMaxCompletionTokens(model)
      ? 'max_completion_tokens'
      : 'max_tokens';
    const useTemperature = supportsTemperature(model);
    try {
      await appendLlmRequestLog({
        ts: new Date().toISOString(),
        label: params.label ?? null,
        model,
        attempt,
        [tokenLimitField]: maxTokens,
        ...(useTemperature ? { temperature } : {}),
        messages: sanitizeMessagesForLog(params.messages),
      });
      // A per-attempt working copy so tool-call turns don't leak across retries.
      const workingMessages: ChatCompletionMessageParam[] = toolset ? [...params.messages] : params.messages;
      const baseCreate = (extra: Record<string, unknown>) => client.chat.completions.create({
        model,
        messages: workingMessages,
        response_format: { type: 'json_object' },
        ...(useTemperature ? { temperature } : {}),
        ...(supportsMaxCompletionTokens(model)
          ? { max_completion_tokens: maxTokens }
          : { max_tokens: maxTokens }),
        ...extra,
      });
      if (toolset) {
        try {
          completion = await runToolRounds({
            messages: workingMessages,
            toolset,
            label: params.label,
            createOnce: (toolChoice) => baseCreate({ tools: toolset.openAiTools, tool_choice: toolChoice }),
          });
        } catch (toolErr) {
          // Some OpenAI-compatible gateways reject the tools/response_format combo;
          // fall back to a plain no-tools generation so the feature can't break AI calls.
          logger.warn(
            { label: params.label, model, err: toolErr instanceof Error ? toolErr.message : String(toolErr) },
            'AI tool rounds failed — falling back to no-tools generation',
          );
          workingMessages.length = 0;
          workingMessages.push(...params.messages);
          completion = await baseCreate({});
        }
      } else {
        completion = await baseCreate({});
      }
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const apiErr = err instanceof APIError ? err : null;
      logger.warn(
        {
          label: params.label,
          model,
          attempt,
          latencyMs,
          status: apiErr?.status,
          code: apiErr?.code,
          message: apiErr?.message ?? (err instanceof Error ? err.message : String(err)),
        },
        'OpenAI chat.completions.create failed',
      );
      // SDK already retried 429/5xx maxRetries times; don't double-retry here.
      if (isRetryable(err)) {
        logger.error(
          { label: params.label, status: apiErr?.status },
          'OpenAI request exhausted retries (retryable status)',
        );
      }
      throw err;
    }

    const latencyMs = Date.now() - startedAt;
    const rawContent = completion.choices[0]?.message?.content ?? '';
    const finishReason = completion.choices[0]?.finish_reason ?? null;
    const usage: TokenUsage = {
      prompt_tokens: completion.usage?.prompt_tokens ?? 0,
      completion_tokens: completion.usage?.completion_tokens ?? 0,
      total_tokens: completion.usage?.total_tokens ?? 0,
    };
    logger.debug(
      {
        label: params.label,
        model,
        attempt,
        latencyMs,
        usage,
        finishReason,
        requestMessages: summarizeMessagesForRuntimeLog(params.messages),
        rawContent: redactTextForLog(rawContent),
      },
      'OpenAI chat JSON response received',
    );
    await appendLlmResponseLog({
      ts: new Date().toISOString(),
      label: params.label ?? null,
      model,
      attempt,
      latencyMs,
      usage,
      finish_reason: finishReason,
      refusal: (completion.choices[0]?.message as { refusal?: unknown } | undefined)?.refusal ?? null,
      raw_content: rawContent,
      raw_content_length: rawContent.length,
    });

    if (finishReason === 'length' && attempt < maxAttempts) {
      logger.warn(
        {
          label: params.label,
          model,
          attempt,
          latencyMs,
          usage,
          requestedMaxTokens,
          generousBaseMaxTokens,
          nextMaxTokens: Math.min(16000, Math.max(generousBaseMaxTokens, Math.ceil(generousBaseMaxTokens * 1.8))),
        },
        'OpenAI response hit max token limit (finish_reason=length) — retrying with larger maxTokens',
      );
      continue;
    }

    try {
      const parsed = JSON.parse(rawContent) as unknown;
      const validated = params.schema.parse(parsed);
      logger.debug(
        {
          label: params.label,
          model,
          attempt,
          latencyMs,
          usage,
        },
        'OpenAI chat JSON ok',
      );
      recordDefaultSourceLlmUsage(accountId, provider, model, usage);
      return { data: validated, usage, latencyMs, rawContent };
    } catch (err) {
      lastErr = err;
      logger.warn(
        {
          label: params.label,
          model,
          attempt,
          latencyMs,
          usage,
          rawContent: redactTextForLog(rawContent),
          error: err instanceof Error ? err.message : String(err),
        },
        attempt < maxAttempts
          ? 'OpenAI JSON parse/validation failed — retrying'
          : 'OpenAI JSON parse/validation failed — giving up',
      );
      // loop will retry
    }
  }

  throw new Error(
    `OpenAI returned invalid JSON after ${maxAttempts} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

export interface ChatTextStreamResult {
  text: string;
  finishReason: string | null;
  usage: TokenUsage;
  latencyMs: number;
}

export interface ChatTextStreamParams {
  model?: string;
  messages: ChatCompletionMessageParam[];
  /** Enforce a sensible cap on the LLM's output. */
  maxTokens?: number;
  temperature?: number;
  /** Optional label for logs to locate slow / failing calls. */
  label?: string;
  /** Called once per chunk of generated text, in order, as it arrives. */
  onDelta: (delta: string) => void;
  /** Read-only tools to offer the model (function-calling). Requires `toolContext`. */
  tools?: AiTool[];
  /** Account/deck scope for tool execution (see aiTools.ts). */
  toolContext?: AiToolContext;
  /** Called just before each tool is executed, so callers can surface progress (e.g. via SSE). */
  onToolCall?: (call: { name: string; args: Record<string, unknown> }) => void;
  /** Aborts the upstream LLM request when the caller cancels (e.g. the client disconnected). */
  signal?: AbortSignal;
}

/**
 * Streams a plain-text completion, invoking `onDelta` for each chunk of text
 * as it's generated. Unlike `callChatJSON`, this does not parse/validate the
 * result against a schema — callers receive the raw accumulated text.
 *
 * Fails over to the account's configured secondary LLM provider the same way callChatJSON does
 * (see isPermanentProviderError / setStickyLlmProvider), but only when the primary provider
 * fails before it has streamed any content back to the caller — once `onDelta` has fired at
 * least once, switching providers mid-stream would mix two different completions together, so a
 * later permanent failure is just surfaced as-is instead.
 */
export async function streamChatText(params: ChatTextStreamParams): Promise<ChatTextStreamResult> {
  const runtime = getRuntimeAiSettings();
  const provider = effectiveLlmProvider(runtime);
  let emittedAny = false;
  const trackedParams: ChatTextStreamParams = {
    ...params,
    onDelta: (delta) => {
      emittedAny = true;
      params.onDelta(delta);
    },
  };
  try {
    return await streamChatTextWithProvider(trackedParams, runtime, provider);
  } catch (err) {
    const secondary = runtime.secondaryLlmProvider;
    if (
      !emittedAny
      && secondary && secondary !== provider
      && getStickyLlmProvider() !== secondary
      && isPermanentProviderError(err)
    ) {
      logger.warn(
        { label: params.label, from: provider, to: secondary, err: err instanceof Error ? err.message : String(err) },
        'LLM primary provider failed permanently — failing over to secondary provider for the rest of this run',
      );
      setStickyLlmProvider(secondary);
      return await streamChatTextWithProvider(trackedParams, runtime, secondary);
    }
    throw err;
  }
}

async function streamChatTextWithProvider(
  params: ChatTextStreamParams,
  runtime: RuntimeAiSettings,
  provider: LlmProvider,
): Promise<ChatTextStreamResult> {
  const accountId = currentAccountId();
  assertDefaultSourceQuotaAvailable(accountId, provider);
  const startedAt = Date.now();

  if (provider === 'gemini') {
    const model = params.model ?? runtime.geminiLlmModel;
    const result = await callGeminiTextStream({
      model,
      messages: params.messages,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      onDelta: params.onDelta,
      signal: params.signal,
    });
    recordDefaultSourceLlmUsage(accountId, provider, model, result.usage);
    return {
      text: result.text,
      finishReason: 'stop',
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
    };
  }

  const client = getOpenAIClient(currentAccountId(), provider);
  const model = params.model ?? providerModel(runtime, provider);
  const maxTokens = Math.max(params.maxTokens ?? 4000, 1);
  const temperature = params.temperature ?? 0.6;
  const useTemperature = supportsTemperature(model);
  const toolset = resolveToolset(provider, params.tools, params.toolContext, params.label);

  await appendLlmRequestLog({
    ts: new Date().toISOString(),
    label: params.label ?? null,
    model,
    stream: true,
    ...(supportsMaxCompletionTokens(model) ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(useTemperature ? { temperature } : {}),
    messages: sanitizeMessagesForLog(params.messages),
  });

  let text = '';
  let finishReason: string | null = null;
  let usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  // Tool-call rounds run on a working copy so appended tool turns don't mutate the caller's array.
  const workingMessages: ChatCompletionMessageParam[] = toolset ? [...params.messages] : params.messages;

  interface AssembledToolCall { id: string; name: string; args: string }

  // Stream one round; forwards content deltas via onDelta and assembles any tool_call deltas.
  const streamRound = async (
    withTools: boolean,
    toolChoice: 'auto' | 'none',
  ): Promise<{ content: string; toolCalls: AssembledToolCall[]; finishReason: string | null }> => {
    let stream: AsyncIterable<{
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
    }>;
    try {
      stream = await client.chat.completions.create(
        {
          model,
          messages: workingMessages,
          stream: true,
          stream_options: { include_usage: true },
          ...(useTemperature ? { temperature } : {}),
          ...(supportsMaxCompletionTokens(model) ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
          ...(withTools && toolset ? { tools: toolset.openAiTools, tool_choice: toolChoice } : {}),
        },
        { signal: params.signal },
      );
    } catch (err) {
      const apiErr = err instanceof APIError ? err : null;
      logger.warn(
        {
          label: params.label,
          model,
          latencyMs: Date.now() - startedAt,
          status: apiErr?.status,
          code: apiErr?.code,
          message: apiErr?.message ?? (err instanceof Error ? err.message : String(err)),
        },
        'OpenAI chat.completions.create (stream) failed',
      );
      throw err;
    }
    let content = '';
    let finish: string | null = null;
    const calls = new Map<number, AssembledToolCall>();
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      const d = choice?.delta;
      if (d?.content) {
        content += d.content;
        params.onDelta(d.content);
      }
      if (d?.tool_calls) {
        for (const tc of d.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = calls.get(idx) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(idx, cur);
        }
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens ?? 0,
          completion_tokens: chunk.usage.completion_tokens ?? 0,
          total_tokens: chunk.usage.total_tokens ?? 0,
        };
      }
    }
    return { content, toolCalls: [...calls.values()], finishReason: finish };
  };

  const runStreamingToolRounds = async (): Promise<void> => {
    for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
      const r = await streamRound(true, round < MAX_TOOL_ROUNDS ? 'auto' : 'none');
      finishReason = r.finishReason;
      if (r.finishReason === 'tool_calls' && r.toolCalls.length) {
        workingMessages.push({
          role: 'assistant',
          content: r.content || '',
          tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
        });
        for (const c of r.toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(c.args || '{}') as Record<string, unknown>; } catch { args = {}; }
          params.onToolCall?.({ name: c.name, args });
          const result = await executeAiTool(toolset!.aiTools, c.name, args, toolset!.toolContext);
          logger.debug({ label: params.label, tool: c.name, round, images: result.images?.length ?? 0 }, 'AI tool executed (stream)');
          workingMessages.push({ role: 'tool', tool_call_id: c.id, content: result.text });
          appendToolImages(workingMessages, result.images);
        }
        continue;
      }
      text = r.content; // final answer round (already streamed via onDelta)
      return;
    }
    // Rounds exhausted: force a final tool-free answer.
    const r = await streamRound(false, 'none');
    text = r.content;
    finishReason = r.finishReason;
  };

  if (toolset) {
    try {
      await runStreamingToolRounds();
    } catch (err) {
      logger.warn(
        { label: params.label, model, err: err instanceof Error ? err.message : String(err) },
        'AI tool streaming failed — falling back to no-tools generation',
      );
      workingMessages.length = 0;
      workingMessages.push(...params.messages);
      const r = await streamRound(false, 'none');
      text = r.content;
      finishReason = r.finishReason;
    }
  } else {
    const r = await streamRound(false, 'none');
    text = r.content;
    finishReason = r.finishReason;
  }

  const latencyMs = Date.now() - startedAt;
  await appendLlmResponseLog({
    ts: new Date().toISOString(),
    label: params.label ?? null,
    model,
    latencyMs,
    usage,
    finish_reason: finishReason,
    raw_content: text,
    raw_content_length: text.length,
  });

  recordDefaultSourceLlmUsage(accountId, provider, model, usage);
  return { text, finishReason, usage, latencyMs };
}
