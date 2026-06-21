import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { decodeSession, parseCookies } from '../auth';
import type { PdfRow } from '../../types';
import { errorResponse, IdParamSchema, PageParamSchema, nowIso } from './shared';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

const ShareTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,128}$/, 'Invalid share token'),
});

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

function getPdfPermissionRow(id: string): Pick<PdfRow, 'owner_sub' | 'visibility'> | undefined {
  return db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
    | Pick<PdfRow, 'owner_sub' | 'visibility'>
    | undefined;
}

const ReportWatchProgressBodySchema = z.object({
  viewer_id: z.string().trim().min(1, 'viewer_id 太短').max(128, 'viewer_id 過長'),
  listened_ms: z.number().int().min(0),
  tab_hidden_ms: z.number().int().min(0),
  duration_ms: z.number().int().min(0).nullable(),
  completed: z.boolean(),
});

interface PageWatchProgressRow {
  pdf_id: string;
  page_number: number;
  viewer_id: string;
  listened_ms: number;
  tab_hidden_ms: number;
  duration_ms: number | null;
  completed: number;
  updated_at: string;
}

interface PageWatchProgressStatsRow {
  page_number: number;
  total_viewers: number;
  completed_viewers: number;
  avg_listened_ratio: number | null;
}

export async function registerWatchProgressRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/:id/pages/:n/watch-progress', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const body = ReportWatchProgressBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow) && !hasShareAccess(request, id)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限回報此簡報的觀看進度'));
    }
    const now = nowIso();
    db.prepare(
      `INSERT INTO page_watch_progress (pdf_id, page_number, viewer_id, listened_ms, tab_hidden_ms, duration_ms, completed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pdf_id, page_number, viewer_id) DO UPDATE SET
         listened_ms = MAX(page_watch_progress.listened_ms, excluded.listened_ms),
         tab_hidden_ms = MAX(page_watch_progress.tab_hidden_ms, excluded.tab_hidden_ms),
         duration_ms = excluded.duration_ms,
         completed = MAX(page_watch_progress.completed, excluded.completed),
         updated_at = excluded.updated_at`,
    ).run(
      id,
      n,
      body.data.viewer_id,
      body.data.listened_ms,
      body.data.tab_hidden_ms,
      body.data.duration_ms,
      body.data.completed ? 1 : 0,
      now,
    );
    const row = db
      .prepare(
        `SELECT pdf_id, page_number, viewer_id, listened_ms, tab_hidden_ms, duration_ms, completed, updated_at
           FROM page_watch_progress WHERE pdf_id = ? AND page_number = ? AND viewer_id = ?`,
      )
      .get(id, n, body.data.viewer_id) as PageWatchProgressRow;
    return reply.send({
      pdf_id: row.pdf_id,
      page_number: row.page_number,
      viewer_id: row.viewer_id,
      listened_ms: row.listened_ms,
      tab_hidden_ms: row.tab_hidden_ms,
      duration_ms: row.duration_ms,
      completed: row.completed === 1,
      updated_at: row.updated_at,
    });
  });

  app.get('/api/pdfs/:id/watch-progress', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的觀看進度統計'));
    }
    const rows = db
      .prepare(
        `SELECT
            page_number,
            COUNT(*) AS total_viewers,
            SUM(completed) AS completed_viewers,
            AVG(CASE WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN CAST(listened_ms AS REAL) / duration_ms ELSE NULL END) AS avg_listened_ratio
          FROM page_watch_progress
         WHERE pdf_id = ?
         GROUP BY page_number
         ORDER BY page_number ASC`,
      )
      .all(parsed.data.id) as PageWatchProgressStatsRow[];
    return reply.send({
      pages: rows.map((row) => ({
        page_number: row.page_number,
        total_viewers: row.total_viewers,
        completed_viewers: row.completed_viewers,
        avg_listened_ratio: row.avg_listened_ratio,
      })),
    });
  });
}
