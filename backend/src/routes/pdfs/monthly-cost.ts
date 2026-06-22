import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { summarizeLlmUsageByRunIds } from '../../services/llmUsage';

interface RunIdRow {
  id: string;
}

export async function registerMonthlyCostRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/usage/monthly-cost', async (_request, reply) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const runRows = db
      .prepare(`SELECT id FROM pipeline_runs WHERE started_at >= ? AND status IN ('succeeded','failed','partial')`)
      .all(monthStart) as RunIdRow[];

    const runIds = runRows.map((r) => r.id);
    const usageByRun = await summarizeLlmUsageByRunIds(runIds);

    let totalCostUsd = 0;
    let hasPrice = false;
    for (const usage of usageByRun.values()) {
      if (typeof usage.estimated_cost_usd === 'number') {
        totalCostUsd += usage.estimated_cost_usd;
        hasPrice = true;
      }
    }

    return reply.send({
      month: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
      total_cost_usd: hasPrice ? Math.round(totalCostUsd * 1_000_000) / 1_000_000 : null,
      run_count: runIds.length,
    });
  });
}
