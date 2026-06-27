import OpenAI, { APIError } from 'openai';
import { toFile } from 'openai/uploads';
import { brotliDecompress as brotliDecompressRaw } from 'node:zlib';
import { promisify } from 'node:util';

const brotliDecompressAsync = promisify(brotliDecompressRaw);
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../logger';
import { callGeminiJson, callGeminiTextStream } from './gemini';
import { getRuntimeAiSettings, type LlmProvider } from './aiSettings';
import { currentAccountId, sanitizeAccountId } from './accountContext';
import { appendLlmRequestLog, appendLlmResponseLog } from './llmUsage';
import { redactLogObject, redactTextForLog } from './logSanitizer';
import { ApiKeyMissingError } from './apiKeyErrors';

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
 */
export function getImageClient(accountId: string = currentAccountId()): ImageGenerationTarget {
  const settings = getRuntimeAiSettings(accountId);
  const selected = settings.llmProvider;
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

export async function transcribeAudioBuffer(
  audio: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const client = getOpenAIClient();
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
): Promise<TranscribedWordTimestamp[]> {
  const client = getOpenAIClient();
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

/**
 * Call Chat Completions with `response_format=json_object` and validate the
 * returned JSON against `schema`. Performs one manual retry on schema-
 * validation failures (separate from the SDK's transport-level retries).
 */
export async function callChatJSON<T>(
  params: ChatJSONParams<T>,
): Promise<ChatJSONResult<T>> {
  const runtime = getRuntimeAiSettings();
  if (runtime.llmProvider === 'gemini') {
    const model = params.model ?? runtime.geminiLlmModel;
    const startedAt = Date.now();
    const result = await callGeminiJson({
      model,
      messages: params.messages,
      schema: params.schema,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });
    return {
      data: result.data,
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
      rawContent: result.rawContent,
    };
  }
  const provider = runtime.llmProvider as OpenAiCompatibleProvider;
  const client = getOpenAIClient(currentAccountId(), provider);
  const model = params.model ?? providerModel(runtime, provider);
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
      completion = await client.chat.completions.create({
        model,
        messages: params.messages,
        response_format: { type: 'json_object' },
        ...(useTemperature ? { temperature } : {}),
        ...(supportsMaxCompletionTokens(model)
          ? { max_completion_tokens: maxTokens }
          : { max_tokens: maxTokens }),
      });
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
}

/**
 * Streams a plain-text completion, invoking `onDelta` for each chunk of text
 * as it's generated. Unlike `callChatJSON`, this does not parse/validate the
 * result against a schema — callers receive the raw accumulated text.
 */
export async function streamChatText(params: ChatTextStreamParams): Promise<ChatTextStreamResult> {
  const runtime = getRuntimeAiSettings();
  const startedAt = Date.now();

  if (runtime.llmProvider === 'gemini') {
    const model = params.model ?? runtime.geminiLlmModel;
    const result = await callGeminiTextStream({
      model,
      messages: params.messages,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      onDelta: params.onDelta,
    });
    return {
      text: result.text,
      finishReason: 'stop',
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
    };
  }

  const provider = runtime.llmProvider as OpenAiCompatibleProvider;
  const client = getOpenAIClient(currentAccountId(), provider);
  const model = params.model ?? providerModel(runtime, provider);
  const maxTokens = Math.max(params.maxTokens ?? 4000, 1);
  const temperature = params.temperature ?? 0.6;
  const useTemperature = supportsTemperature(model);

  await appendLlmRequestLog({
    ts: new Date().toISOString(),
    label: params.label ?? null,
    model,
    stream: true,
    ...(supportsMaxCompletionTokens(model) ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(useTemperature ? { temperature } : {}),
    messages: sanitizeMessagesForLog(params.messages),
  });

  let stream: AsyncIterable<{
    choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  }>;
  try {
    stream = await client.chat.completions.create({
      model,
      messages: params.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(useTemperature ? { temperature } : {}),
      ...(supportsMaxCompletionTokens(model)
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
    });
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

  let text = '';
  let finishReason: string | null = null;
  let usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    const delta = choice?.delta?.content ?? '';
    if (delta) {
      text += delta;
      params.onDelta(delta);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) {
      usage = {
        prompt_tokens: chunk.usage.prompt_tokens ?? 0,
        completion_tokens: chunk.usage.completion_tokens ?? 0,
        total_tokens: chunk.usage.total_tokens ?? 0,
      };
    }
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

  return { text, finishReason, usage, latencyMs };
}
