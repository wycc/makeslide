import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { decodeSession, parseCookies } from '../auth';
import type { PageArtifact, PdfRow, SlowArtifactSummary, TimingEventStatus, TimingSlaStatus } from '../../types';
import { IdParamSchema, errorResponse } from './shared';

const DEFAULT_SLOW_ARTIFACT_LIMIT = 5;
const MAX_SLOW_ARTIFACT_LIMIT = 20;

const SlowArtifactsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_SLOW_ARTIFACT_LIMIT).optional(),
});

const ShareTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,128}$/, 'Invalid share token'),
});

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

function getShareToken(request: FastifyRequest): string | null {
  const rawHeader = request.headers['x-makeslide-share-token'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  const query = request.query as Record<string, unknown> | undefined;
  const rawQuery = query?.share;
  const queryValue = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;
  return typeof queryValue === 'string' && queryValue.trim() ? queryValue.trim() : null;
}

function hasShareAccess(request: FastifyRequest, pdfId: string): boolean {
  const token = getShareToken(request);
  if (!token || !ShareTokenParamSchema.safeParse({ token }).success) return false;
  const row = db.prepare(`SELECT access FROM pdf_shares WHERE token = ? AND pdf_id = ?`).get(token, pdfId) as
    | { access: 'read_only' | 'editable' }
    | undefined;
  return Boolean(row);
}

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
    const pdf = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdf) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!hasShareAccess(request, id) && !canReadPdf(sessionSub(request), pdf)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的素材耗時排行'));
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
