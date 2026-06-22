import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { decodeSession, parseCookies } from '../auth';
import type { PdfRow } from '../../types';
import { PageParamSchema, errorResponse, nowIso } from './shared';

const SaveDrawingBodySchema = z.object({
  drawing_json: z.string().max(2_000_000),
});

const ShareTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,128}$/, 'Invalid share token'),
});

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

// Stricter variant for this file's one destructive/irreversible route (deleting the whole
// drawing for a page). Reuses canEditPdf()'s owner/public_editable logic but additionally
// requires an authenticated session before the public_editable fallback applies, so a fully
// anonymous request can never wipe a page's drawing just because the presentation's visibility
// happens to be public_editable. PUT (saving/overwriting a drawing) keeps using canEditPdf()
// unchanged — overwriting is the expected behavior of the drawing tool itself (e.g. an
// in-progress stroke autosave), not a one-way destructive action distinct from normal editing.
// Mirrors delete.ts's canEditPdf() fix.
function canDestructivelyEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return Boolean(sub) && row.visibility === 'public_editable';
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

function getPdfPermissionRow(id: string): Pick<PdfRow, 'owner_sub' | 'visibility'> | undefined {
  return db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
    | Pick<PdfRow, 'owner_sub' | 'visibility'>
    | undefined;
}

export async function registerDrawingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/pages/:n/drawing', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const pageRow = db.prepare(`SELECT page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n) as
      | { page_uid: string }
      | undefined;
    if (!pageRow) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    if (!hasShareAccess(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的畫板'));
    }
    const row = db
      .prepare(`SELECT drawing_json, updated_at FROM page_drawings WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { drawing_json: string; updated_at: string } | undefined;
    if (!row) {
      return reply.code(200).send({ drawing_json: null });
    }
    return reply.code(200).send({ drawing_json: row.drawing_json, updated_at: row.updated_at });
  });

  app.put('/api/pdfs/:id/pages/:n/drawing', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = SaveDrawingBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的畫板'));
    }
    const now = nowIso();
    db.prepare(
      `INSERT OR REPLACE INTO page_drawings (pdf_id, page_number, drawing_json, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(id, n, parsedBody.data.drawing_json, now);
    return reply.code(200).send({ ok: true, updated_at: now });
  });

  app.delete('/api/pdfs/:id/pages/:n/drawing', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!canDestructivelyEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的畫板'));
    }
    db.prepare(`DELETE FROM page_drawings WHERE pdf_id = ? AND page_number = ?`).run(id, n);
    return reply.code(204).send();
  });
}
