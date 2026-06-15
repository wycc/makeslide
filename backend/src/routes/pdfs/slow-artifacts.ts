import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import type { PageArtifact, SlowArtifactSummary, TimingEventStatus, TimingSlaStatus } from '../../types';
import { IdParamSchema, errorResponse } from './shared';

const DEFAULT_SLOW_ARTIFACT_LIMIT = 5;
const MAX_SLOW_ARTIFACT_LIMIT = 20;

const SlowArtifactsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_SLOW_ARTIFACT_LIMIT).optional(),
});

interface SlowArtifactRow {
  page_number: number;
  artifact: PageArtifact;
  status: TimingEventStatus;
  duration_ms: number | null;
  sla_target_ms: number | null;
  sla_status: TimingSlaStatus;
  updated_at: string;
}

export async function registerSlowArtifactRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/pdfs/:id/slow-artifacts — ranks this PDF's page artifacts
  // (image/text/script/audio) by their latest recorded duration_ms, for the
  // "系統資料" tab's slow artifact ranking section.
  app.get('/api/pdfs/:id/slow-artifacts', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    const parsedQuery = SlowArtifactsQuerySchema.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid slow artifact request'));
    }
    const { id } = parsedParams.data;
    const pdf = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as { id: string } | undefined;
    if (!pdf) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const limit = parsedQuery.data.limit ?? DEFAULT_SLOW_ARTIFACT_LIMIT;
    const rows = db
      .prepare(
        `SELECT page_number, artifact, status, duration_ms, sla_target_ms, sla_status, updated_at
           FROM page_artifact_timings
          WHERE pdf_id = ? AND duration_ms IS NOT NULL
          ORDER BY duration_ms DESC, page_number ASC LIMIT ?`,
      )
      .all(id, limit) as SlowArtifactRow[];
    const artifacts: SlowArtifactSummary[] = rows.map((row) => ({
      page_number: row.page_number,
      artifact: row.artifact,
      status: row.status,
      duration_ms: row.duration_ms,
      sla_target_ms: row.sla_target_ms,
      sla_status: row.sla_status,
      updated_at: row.updated_at,
    }));
    return reply.code(200).send({ artifacts });
  });
}
