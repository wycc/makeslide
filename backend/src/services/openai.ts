import OpenAI, { APIError } from 'openai';
import { toFile } from 'openai/uploads';
import fs from 'node:fs';
import path from 'node:path';
import { brotliDecompress as brotliDecompressRaw } from 'node:zlib';
import { promisify } from 'node:util';

const brotliDecompressAsync = promisify(brotliDecompressRaw);
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../logger';
import { callGeminiJson, callGeminiText } from './gemini';
import { getRuntimeAiSettings } from './aiSettings';
import { currentAccountId, sanitizeAccountId } from './accountContext';

interface AccountOpenAiState {
  client: OpenAI | null;
  apiKeyOverride: string | null;
  baseUrlOverride: string | null;
}

// 每個帳號各自快取自己的 OpenAI client / API key 覆寫值，避免使用者 A 變更
// API key 時意外影響到使用者 B 正在進行中或稍後才執行的請求。
const accountStates = new Map<string, AccountOpenAiState>();

function getAccountState(accountId: string): AccountOpenAiState {
  const safeAccountId = sanitizeAccountId(accountId);
  let state = accountStates.get(safeAccountId);
  if (!state) {
    state = { client: null, apiKeyOverride: null, baseUrlOverride: null };
    accountStates.set(safeAccountId, state);
  }
  return state;
}

// 僅供測試使用：強制所有帳號回傳同一顆 stub client。
let testClientOverride: OpenAI | null | undefined;
const LLM_REQUEST_LOG_FILE = path.join(process.cwd(), 'backend', 'data', 'llm-requests.log.jsonl');

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

async function appendLlmRequestLog(entry: unknown): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(LLM_REQUEST_LOG_FILE), { recursive: true });
    await fs.promises.appendFile(
      LLM_REQUEST_LOG_FILE,
      `${JSON.stringify(entry)}\n`,
      'utf8',
    );
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to write llm request log file',
    );
  }
}

async function appendLlmResponseLog(entry: unknown): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(LLM_REQUEST_LOG_FILE), { recursive: true });
    await fs.promises.appendFile(
      LLM_REQUEST_LOG_FILE,
      `${JSON.stringify({ kind: 'response', ...((entry as object) ?? {}) })}\n`,
      'utf8',
    );
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to write llm response log file',
    );
  }
}

/**
 * Lazily instantiated OpenAI client. Throws a clear error if the API key is
 * missing so the server can still start (and serve M2 endpoints) when the
 * operator has not configured M3 yet.
 */
export function getOpenAIClient(accountId: string = currentAccountId()): OpenAI {
  if (testClientOverride !== undefined) return testClientOverride as OpenAI;

  const state = getAccountState(accountId);
  if (state.client) return state.client;

  const settings = getRuntimeAiSettings(accountId);
  const apiKey = (state.apiKeyOverride ?? settings.openaiApiKey ?? '').trim();
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set — cannot call OpenAI. Update your .env and restart.',
    );
  }
  const baseURL = (state.baseUrlOverride ?? settings.openaiBaseUrl ?? '').trim() || undefined;

  const debugFetch: typeof globalThis.fetch = async (url, init) => {
    const resp = await globalThis.fetch(url as Parameters<typeof globalThis.fetch>[0], init);
    const clone = resp.clone();
    const buf = Buffer.from(await clone.arrayBuffer());

    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => { respHeaders[k] = v; });
    console.log(`[OpenAI raw response] status=${resp.status} url=${url.toString()}`);
    console.log(`[OpenAI raw headers] ${JSON.stringify(respHeaders)}`);
    console.log(`[OpenAI raw hex] ${buf.toString('hex')}`);
    console.log(`[OpenAI raw utf8] ${buf.toString('utf8')}`);

    // Auto-fix: if server sent brotli without Content-Encoding header, decompress manually
    const contentEncoding = resp.headers.get('content-encoding') ?? '';
    if (contentEncoding.includes('br') || (!contentEncoding && buf[0] === 0x1b)) {
      try {
        const decompressed = await brotliDecompressAsync(buf);
        console.log(`[OpenAI brotli decompressed] ${decompressed.toString('utf8')}`);
        const fixedHeaders = new Headers(resp.headers);
        fixedHeaders.delete('content-encoding');
        fixedHeaders.delete('content-length');
        return new Response(decompressed, {
          status: resp.status,
          statusText: resp.statusText,
          headers: fixedHeaders,
        });
      } catch (e) {
        console.log(`[OpenAI brotli decompress failed] ${String(e)}`);
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
      model: config.openaiLlmModel,
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
  const state = getAccountState(accountId);
  state.apiKeyOverride = apiKey.trim();
  state.client = null;
}

export function setOpenAIBaseUrlRuntime(accountId: string, baseUrl: string): void {
  const state = getAccountState(accountId);
  state.baseUrlOverride = baseUrl.trim() || null;
  state.client = null;
}

export function setOpenAIClientForTest(client: OpenAI | null): void {
  testClientOverride = client;
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
  const client = getOpenAIClient();
  const model = params.model ?? runtime.openaiLlmModel;
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
    console.log(JSON.stringify(sanitizeMessagesForLog(params.messages)));
    console.log('---------------');
    console.log(JSON.stringify(completion));
    console.log({ rawContent, usage, latencyMs });
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
      console.log(rawContent);

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
      console.log(err);
      logger.warn(
        {
          label: params.label,
          model,
          attempt,
          latencyMs,
          usage,
          rawPreview: rawContent.slice(0, 200),
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
 *
 * Gemini does not support token-by-token streaming in this codebase yet, so
 * for that provider the full response is fetched non-streaming and then
 * delivered to `onDelta` as a single chunk once it's ready.
 */
export async function streamChatText(params: ChatTextStreamParams): Promise<ChatTextStreamResult> {
  const runtime = getRuntimeAiSettings();
  const startedAt = Date.now();

  if (runtime.llmProvider === 'gemini') {
    const model = params.model ?? runtime.geminiLlmModel;
    const result = await callGeminiText({
      model,
      messages: params.messages,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });
    if (result.text) params.onDelta(result.text);
    return {
      text: result.text,
      finishReason: 'stop',
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
    };
  }

  const client = getOpenAIClient();
  const model = params.model ?? runtime.openaiLlmModel;
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
