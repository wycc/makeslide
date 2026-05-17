import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { db } from '../../db';

const LLM_REQUEST_LOG_FILE = path.join(process.cwd(), 'backend', 'data', 'llm-requests.log.jsonl');

interface CountRow {
  count: number;
}

interface OptionalCountRow {
  count: number | null;
}

interface StatusCountRow {
  status: string;
  count: number;
}

interface LlmUsageSummary {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_latency_ms: number;
  estimated_cost_usd: number | null;
}

const MODEL_PRICE_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
};

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function readCount(sql: string, params: unknown[] = []): number {
  const row = db.prepare(sql).get(...params) as CountRow | undefined;
  return row?.count ?? 0;
}

function readOptionalCount(sql: string): number | null {
  const row = db.prepare(sql).get() as OptionalCountRow | undefined;
  return row?.count ?? null;
}

async function summarizeLlmUsage(): Promise<LlmUsageSummary> {
  const summary: LlmUsageSummary = {
    requests: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    total_latency_ms: 0,
    estimated_cost_usd: null,
  };

  if (!fs.existsSync(LLM_REQUEST_LOG_FILE)) return summary;

  const stream = fs.createReadStream(LLM_REQUEST_LOG_FILE, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let estimatedCost = 0;
  let hasPrice = false;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        model?: string;
        latencyMs?: number;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      if (event.type !== 'response' || !event.usage) continue;
      const promptTokens = Number(event.usage.prompt_tokens ?? 0);
      const completionTokens = Number(event.usage.completion_tokens ?? 0);
      summary.requests += 1;
      summary.prompt_tokens += promptTokens;
      summary.completion_tokens += completionTokens;
      summary.total_tokens += Number(event.usage.total_tokens ?? promptTokens + completionTokens);
      summary.total_latency_ms += Number(event.latencyMs ?? 0);

      const price = event.model ? MODEL_PRICE_PER_1M_TOKENS[event.model] : undefined;
      if (price) {
        hasPrice = true;
        estimatedCost += (promptTokens / 1_000_000) * price.input;
        estimatedCost += (completionTokens / 1_000_000) * price.output;
      }
    } catch {
      // Ignore malformed historical log lines.
    }
  }

  summary.estimated_cost_usd = hasPrice ? Math.round(estimatedCost * 1_000_000) / 1_000_000 : null;
  return summary;
}

export async function registerObservabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/system/observability', async (_request, reply) => {
    const totalPdfs = readCount(`SELECT COUNT(*) AS count FROM pdfs`);
    const completedPdfs = readCount(`SELECT COUNT(*) AS count FROM pdfs WHERE status = 'ready'`);
    const failedPdfs = readCount(`SELECT COUNT(*) AS count FROM pdfs WHERE status = 'failed'`);
    const processingPdfs = readCount(
      `SELECT COUNT(*) AS count FROM pdfs WHERE status NOT IN ('ready', 'failed')`,
    );

    const totalRuns = readCount(`SELECT COUNT(*) AS count FROM pipeline_runs`);
    const succeededRuns = readCount(`SELECT COUNT(*) AS count FROM pipeline_runs WHERE status = 'succeeded'`);
    const failedRuns = readCount(`SELECT COUNT(*) AS count FROM pipeline_runs WHERE status = 'failed'`);
    const runningRuns = readCount(`SELECT COUNT(*) AS count FROM pipeline_runs WHERE status = 'running'`);
    const avgRunDurationMs = readOptionalCount(
      `SELECT ROUND(AVG(duration_ms)) AS count FROM pipeline_runs WHERE duration_ms IS NOT NULL`,
    );

    const stageRows = db
      .prepare(
        `SELECT status, COUNT(*) AS count
           FROM pipeline_stage_summaries
          GROUP BY status
          ORDER BY count DESC`,
      )
      .all() as StatusCountRow[];
    const artifactRows = db
      .prepare(
        `SELECT status, COUNT(*) AS count
           FROM page_artifact_timings
          GROUP BY status
          ORDER BY count DESC`,
      )
      .all() as StatusCountRow[];

    const llmUsage = await summarizeLlmUsage();

    return reply.code(200).send({
      generated_at: new Date().toISOString(),
      pdfs: {
        total: totalPdfs,
        completed: completedPdfs,
        failed: failedPdfs,
        processing: processingPdfs,
        success_rate: pct(completedPdfs, totalPdfs),
        failure_rate: pct(failedPdfs, totalPdfs),
      },
      pipeline_runs: {
        total: totalRuns,
        succeeded: succeededRuns,
        failed: failedRuns,
        running: runningRuns,
        success_rate: pct(succeededRuns, totalRuns),
        failure_rate: pct(failedRuns, totalRuns),
        average_duration_ms: avgRunDurationMs,
      },
      stages: stageRows,
      artifacts: artifactRows,
      llm_usage: {
        ...llmUsage,
        average_latency_ms:
          llmUsage.requests > 0 ? Math.round(llmUsage.total_latency_ms / llmUsage.requests) : null,
      },
    });
  });
}
