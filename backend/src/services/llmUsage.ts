import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { LlmUsageSummary } from '../types';
import { logger } from '../logger';

/**
 * JSONL log of every LLM request/response written by `services/openai.ts`
 * and `services/gemini.ts`. Shared here so both writers and the readers
 * (observability/run-history routes) agree on the file location and schema.
 */
export const LLM_REQUEST_LOG_FILE = path.join(process.cwd(), 'backend', 'data', 'llm-requests.log.jsonl');

export const MODEL_PRICE_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  // Gemini pricing (per 1M tokens, text-only tier as of 2025-06)
  'gemini-2.0-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash-lite': { input: 0.0375, output: 0.15 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
};

interface LlmResponseLogEvent {
  kind?: string;
  model?: string;
  latencyMs?: number;
  pdf_id?: string;
  run_id?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** 目前執行情境（哪個 PDF／pipeline run）正在發出 LLM 請求，供 log 寫入時附帶關聯欄位。 */
export interface LlmCallContext {
  pdfId?: string;
  runId?: string;
}

const llmContextStorage = new AsyncLocalStorage<LlmCallContext>();

/**
 * 設定「目前」非同步情境的 LLM 呼叫關聯資訊（pdf_id/run_id）。供 pipeline/regenerate
 * worker 在 startRun() 之後呼叫一次即可；之後該情境下（含其觸發的非同步操作）所有
 * callChatJSON/streamChatText 寫入的 log 都會自動帶上這些欄位。
 */
export function setLlmUsageContext(ctx: LlmCallContext): void {
  llmContextStorage.enterWith(ctx);
}

/** 取得目前情境的 LLM 呼叫關聯資訊；情境外回傳 undefined。 */
export function currentLlmUsageContext(): LlmCallContext | undefined {
  return llmContextStorage.getStore();
}

function llmLogContextFields(): { pdf_id?: string; run_id?: string } {
  const ctx = currentLlmUsageContext();
  const fields: { pdf_id?: string; run_id?: string } = {};
  if (ctx?.pdfId) fields.pdf_id = ctx.pdfId;
  if (ctx?.runId) fields.run_id = ctx.runId;
  return fields;
}

/** Append a request-kind entry to the LLM JSONL log. Used by openai.ts and gemini.ts. */
export async function appendLlmRequestLog(entry: object): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(LLM_REQUEST_LOG_FILE), { recursive: true });
    await fs.promises.appendFile(
      LLM_REQUEST_LOG_FILE,
      `${JSON.stringify({ ...llmLogContextFields(), ...(entry ?? {}) })}\n`,
      'utf8',
    );
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to write llm request log file',
    );
  }
}

/** Append a response-kind entry (with `kind: 'response'`) to the LLM JSONL log. */
export async function appendLlmResponseLog(entry: object): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(LLM_REQUEST_LOG_FILE), { recursive: true });
    await fs.promises.appendFile(
      LLM_REQUEST_LOG_FILE,
      `${JSON.stringify({ kind: 'response', ...llmLogContextFields(), ...(entry ?? {}) })}\n`,
      'utf8',
    );
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to write llm response log file',
    );
  }
}

export function emptyLlmUsageSummary(): LlmUsageSummary {
  return {
    requests: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    total_latency_ms: 0,
    estimated_cost_usd: null,
  };
}

class UsageAccumulator {
  summary = emptyLlmUsageSummary();
  private estimatedCost = 0;
  private hasPrice = false;

  add(event: LlmResponseLogEvent): void {
    const promptTokens = Number(event.usage?.prompt_tokens ?? 0);
    const completionTokens = Number(event.usage?.completion_tokens ?? 0);
    this.summary.requests += 1;
    this.summary.prompt_tokens += promptTokens;
    this.summary.completion_tokens += completionTokens;
    this.summary.total_tokens += Number(event.usage?.total_tokens ?? promptTokens + completionTokens);
    this.summary.total_latency_ms += Number(event.latencyMs ?? 0);

    const price = event.model ? MODEL_PRICE_PER_1M_TOKENS[event.model] : undefined;
    if (price) {
      this.hasPrice = true;
      this.estimatedCost += (promptTokens / 1_000_000) * price.input;
      this.estimatedCost += (completionTokens / 1_000_000) * price.output;
    }
  }

  finalize(): LlmUsageSummary {
    this.summary.estimated_cost_usd = this.hasPrice ? Math.round(this.estimatedCost * 1_000_000) / 1_000_000 : null;
    return this.summary;
  }
}

export interface LlmUsageFilter {
  pdfId?: string;
  runId?: string;
}

function matchesFilter(event: LlmResponseLogEvent, filter?: LlmUsageFilter): boolean {
  if (!filter) return true;
  if (filter.pdfId && event.pdf_id !== filter.pdfId) return false;
  if (filter.runId && event.run_id !== filter.runId) return false;
  return true;
}

/** 彙總 LLM 用量／成本，可選擇依 pdf_id 或 run_id 篩選；未提供 filter 時回傳全域總計。 */
export async function summarizeLlmUsage(filter?: LlmUsageFilter): Promise<LlmUsageSummary> {
  const acc = new UsageAccumulator();
  if (!fs.existsSync(LLM_REQUEST_LOG_FILE)) return acc.finalize();

  const stream = fs.createReadStream(LLM_REQUEST_LOG_FILE, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as LlmResponseLogEvent;
      if (event.kind !== 'response' || !event.usage) continue;
      if (!matchesFilter(event, filter)) continue;
      acc.add(event);
    } catch {
      // Ignore malformed historical log lines.
    }
  }

  return acc.finalize();
}

/**
 * 單次讀取 log 檔，依 run_id 分組彙總 LLM 用量／成本。供 run history API 一次
 * 取得多個 pipeline run 的成本資訊，避免每個 run 各自掃描整個檔案。沒有對應
 * log 紀錄的 run（例如此功能上線前的舊 run）不會出現在回傳的 Map 中。
 */
export async function summarizeLlmUsageByRunIds(runIds: readonly string[]): Promise<Map<string, LlmUsageSummary>> {
  const result = new Map<string, LlmUsageSummary>();
  if (runIds.length === 0 || !fs.existsSync(LLM_REQUEST_LOG_FILE)) return result;

  const wantedRunIds = new Set(runIds);
  const accumulators = new Map<string, UsageAccumulator>();

  const stream = fs.createReadStream(LLM_REQUEST_LOG_FILE, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as LlmResponseLogEvent;
      if (event.kind !== 'response' || !event.usage) continue;
      if (!event.run_id || !wantedRunIds.has(event.run_id)) continue;
      let acc = accumulators.get(event.run_id);
      if (!acc) {
        acc = new UsageAccumulator();
        accumulators.set(event.run_id, acc);
      }
      acc.add(event);
    } catch {
      // Ignore malformed historical log lines.
    }
  }

  for (const [runId, acc] of accumulators) {
    result.set(runId, acc.finalize());
  }
  return result;
}
