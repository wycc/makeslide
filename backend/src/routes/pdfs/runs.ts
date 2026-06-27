import type { FastifyInstance, FastifyRequest } from 'fastify';
import { canReadPdf } from './permissions';
import { z } from 'zod';
import { db } from '../../db';
import { decodeSession, parseCookies } from '../auth';
import { emptyLlmUsageSummary, summarizeLlmUsageByRunIds } from '../../services/llmUsage';
import { TIMING_EVENT_VALUES } from '../../services/timing';
import type {
  PdfRow,
  PipelineRunStageSummary,
  PipelineRunStatus,
  PipelineRunSummary,
  PipelineRunType,
  PipelineStage,
  TimingEventStatus,
  TimingSlaStatus,
} from '../../types';
import { IdParamSchema, errorResponse } from './shared';

const DEFAULT_RUN_HISTORY_LIMIT = 20;
const MAX_RUN_HISTORY_LIMIT = 100;

const RunHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_RUN_HISTORY_LIMIT).optional(),
});

const STAGE_ORDER = new Map<PipelineStage, number>(TIMING_EVENT_VALUES.stages.map((stage, index) => [stage, index]));

const ShareTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,128}$/, 'Invalid share token'),
});

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
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

interface PipelineRunRow {
  id: string;
  run_type: PipelineRunType;
  parent_run_id: string | null;
  triggered_by: string;
  status: PipelineRunStatus;
  attempt: number;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  sla_status: TimingSlaStatus;
  error_code: string | null;
  error_message: string | null;
  metadata_json: string | null;
}

interface PipelineStageSummaryRow {
  stage: PipelineStage;
  status: TimingEventStatus;
  attempt: number;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  sla_target_ms: number | null;
  sla_status: TimingSlaStatus;
  error_code: string | null;
  error_message: string | null;
}

function parseMetadata(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function loadStageSummaries(runId: string): PipelineRunStageSummary[] {
  const rows = db
    .prepare(
      `SELECT stage, status, attempt, started_at, ended_at, duration_ms, sla_target_ms, sla_status, error_code, error_message
         FROM pipeline_stage_summaries WHERE run_id = ?`,
    )
    .all(runId) as PipelineStageSummaryRow[];
  return rows
    .slice()
    .sort((a, b) => (STAGE_ORDER.get(a.stage) ?? 0) - (STAGE_ORDER.get(b.stage) ?? 0))
    .map((row) => ({
      stage: row.stage,
      status: row.status,
      attempt: row.attempt,
      started_at: row.started_at,
      ended_at: row.ended_at,
      duration_ms: row.duration_ms,
      sla_target_ms: row.sla_target_ms,
      sla_status: row.sla_status,
      error_code: row.error_code,
      error_message: row.error_message,
    }));
}

export async function registerRunHistoryRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/pdfs/:id/runs — pipeline run history for this PDF (each
  // initial/regenerate/resume/... run with its per-stage breakdown), for the
  // "系統資料" tab's run history section.
  app.get('/api/pdfs/:id/runs', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    const parsedQuery = RunHistoryQuerySchema.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid run history request'));
    }
    const { id } = parsedParams.data;
    const pdf = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdf) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!hasShareAccess(request, id) && !canReadPdf(sessionSub(request), pdf)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的執行歷程'));
    }
    const limit = parsedQuery.data.limit ?? DEFAULT_RUN_HISTORY_LIMIT;
    const runRows = db
      .prepare(
        `SELECT id, run_type, parent_run_id, triggered_by, status, attempt, started_at, ended_at, duration_ms, sla_status, error_code, error_message, metadata_json
           FROM pipeline_runs WHERE pdf_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`,
      )
      .all(id, limit) as PipelineRunRow[];
    const llmUsageByRun = await summarizeLlmUsageByRunIds(runRows.map((row) => row.id));
    const runs: PipelineRunSummary[] = runRows.map((row) => ({
      id: row.id,
      run_type: row.run_type,
      parent_run_id: row.parent_run_id,
      triggered_by: row.triggered_by,
      status: row.status,
      attempt: row.attempt,
      started_at: row.started_at,
      ended_at: row.ended_at,
      duration_ms: row.duration_ms,
      sla_status: row.sla_status,
      error_code: row.error_code,
      error_message: row.error_message,
      metadata: parseMetadata(row.metadata_json),
      stages: loadStageSummaries(row.id),
      llm_usage: llmUsageByRun.get(row.id) ?? emptyLlmUsageSummary(),
    }));
    return reply.code(200).send({ runs });
  });
}
