import fs from 'node:fs';
import { canReadPdf, canEditPdf } from './permissions';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { sessionSub } from '../auth';
import type { PdfRow } from '../../types';
import {
  figureImageAbsPath,
  findFigureById,
  getPageFigures,
  loadFigureSelection,
  loadSplitPageFigureMap,
  saveFigureSelection,
} from '../../services/pdfFigures';
import type { FigureEntry } from '../../worker/steps/extractPdfFigures';
import { IdParamSchema, PageParamSchema, errorResponse, nowIso, streamFile } from './shared';

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

const MAX_EXCLUDED_FIGURES = 50;

const SaveFigureSelectionBodySchema = z.object({
  excluded: z.array(z.string().min(1).max(200)).max(MAX_EXCLUDED_FIGURES),
});

const FigureImageParamSchema = IdParamSchema.extend({
  figureId: z.string().min(1).max(200),
});

interface FigurePageRow {
  page_uid: string;
}

function getFigurePageRow(id: string, n: number): FigurePageRow | undefined {
  return db.prepare(`SELECT page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n) as FigurePageRow | undefined;
}

/** Document-mode imports map a slide's page_number to one or more original PDF page numbers via split-figure-map.json; raster imports use the page_number directly. */
function resolveSourcePdfPages(id: string, n: number): number[] {
  const map = loadSplitPageFigureMap(id);
  return map?.[n] ?? [n];
}

/** Aggregates figures across `pageNumbers`, deduped by figure id, preserving largest-first-page order. */
function collectFigures(id: string, pageNumbers: number[]): FigureEntry[] {
  const seen = new Set<string>();
  const all: FigureEntry[] = [];
  for (const pageNumber of pageNumbers) {
    for (const figure of getPageFigures(id, pageNumber)) {
      if (seen.has(figure.id)) continue;
      seen.add(figure.id);
      all.push(figure);
    }
  }
  return all;
}

export async function registerFigureRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/pdfs/:id/pages/:n/figures — list the figures extracted from this
  // slide's source PDF page(s), for the figure-asset browser/picker UI.
  app.get('/api/pdfs/:id/pages/:n/figures', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const row = getFigurePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    if (!hasShareAccess(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的圖表素材'));
    }
    const sourcePdfPages = resolveSourcePdfPages(id, n);
    const figures = collectFigures(id, sourcePdfPages);
    const selection = loadFigureSelection(id, row.page_uid);
    const excluded = new Set(selection.excluded);
    return reply.code(200).send({
      page_number: n,
      source_pdf_pages: sourcePdfPages,
      figures: figures.map((figure) => ({
        id: figure.id,
        caption: figure.caption,
        context: figure.context,
        bbox: figure.bbox,
        source: figure.source ?? 'raster',
        image_url: `api/pdfs/${id}/figures/${encodeURIComponent(figure.id)}/image`,
        excluded: excluded.has(figure.id),
      })),
    });
  });

  // PUT /api/pdfs/:id/pages/:n/figures/selection — persist which extracted
  // figures the user excluded from use as image-generation reference for this slide.
  app.put('/api/pdfs/:id/pages/:n/figures/selection', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = SaveFigureSelectionBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的圖表選取'));
    }
    const row = getFigurePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const excluded = [...new Set(parsedBody.data.excluded)];
    saveFigureSelection(id, row.page_uid, { excluded });
    return reply.code(200).send({ page_number: n, excluded, updated_at: nowIso() });
  });

  // GET /api/pdfs/:id/figures/:figureId/image — streams an extracted figure's PNG.
  app.get('/api/pdfs/:id/figures/:figureId/image', async (request, reply) => {
    const parsed = FigureImageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or figure id'));
    }
    const { id, figureId } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const figure = findFigureById(id, figureId);
    if (!figure) {
      return reply.code(404).send(errorResponse('FIGURE_NOT_FOUND', 'Figure not found'));
    }
    if (!hasShareAccess(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的圖表圖片'));
    }
    const abs = figureImageAbsPath(id, figure);
    if (!fs.existsSync(abs)) {
      return reply.code(404).send(errorResponse('FIGURE_NOT_FOUND', 'Figure image file missing'));
    }
    return streamFile(reply, abs, 'image/png', 'public, max-age=300');
  });
}
