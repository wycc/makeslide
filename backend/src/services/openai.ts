import OpenAI, { APIError } from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../logger';

let cachedClient: OpenAI | null = null;
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

/**
 * Lazily instantiated OpenAI client. Throws a clear error if the API key is
 * missing so the server can still start (and serve M2 endpoints) when the
 * operator has not configured M3 yet.
 */
export function getOpenAIClient(): OpenAI {
  if (cachedClient) return cachedClient;
  if (!config.openaiApiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set — cannot call OpenAI. Update your .env and restart.',
    );
  }
  cachedClient = new OpenAI({
    apiKey: config.openaiApiKey,
    timeout: config.openaiRequestTimeoutMs,
    maxRetries: config.openaiMaxRetries,
  });
  logger.info(
    {
      model: config.openaiLlmModel,
      timeoutMs: config.openaiRequestTimeoutMs,
      maxRetries: config.openaiMaxRetries,
      maxPages: config.openaiMaxPages,
    },
    'OpenAI client initialised',
  );
  return cachedClient;
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
  schema: z.ZodType<T>;
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
  const client = getOpenAIClient();
  const model = params.model ?? config.openaiLlmModel;
  const maxAttempts = 2; // parse/validate retries (on top of SDK retries)
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    let completion: ChatCompletion;
    const maxTokens = params.maxTokens ?? 800;
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
    const usage: TokenUsage = {
      prompt_tokens: completion.usage?.prompt_tokens ?? 0,
      completion_tokens: completion.usage?.completion_tokens ?? 0,
      total_tokens: completion.usage?.total_tokens ?? 0,
    };

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
