import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { summarizeLlmUsage } from '../../services/llmUsage';

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
