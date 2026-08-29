import fs from 'node:fs';
import { ShareTokenParamSchema, getShareToken } from './share';
import { getPdfPermissionRow, canReadPdf, canEditPdf , aclCtx } from './permissions';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { sessionSub } from '../auth';
import type { PdfRow } from '../../types';
import {
  addPageFigure,
  figureImageAbsPath,
  findFigureById,
  getPageFigures,
  loadFigureSelection,
  loadSplitPageFigureMap,
  saveFigureSelection,
} from '../../services/pdfFigures';
import type { FigureEntry } from '../../worker/steps/extractPdfFigures';
import { IdParamSchema, PageParamSchema, errorResponse, nowIso, streamFile } from './shared';

const MAX_EXCLUDED_FIGURES = 50;
const MAX_FIGURE_CAPTION_CHARS = 1000;
const MAX_FIGURE_CONTEXT_CHARS = 4000;

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
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的圖表素材'));
    }
    const sourcePdfPages = resolveSourcePdfPages(id, n);
    // User uploads are stored against the final slide number so regenerate-image
    // can consume them. Include that page in addition to mapped source PDF pages.
    const figures = collectFigures(id, [...new Set([n, ...sourcePdfPages])]);
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

  // POST /api/pdfs/:id/pages/:n/figures — upload an image and register it as a
  // page-specific generation reference. Multipart fields: file, caption?, context?.
  app.post('/api/pdfs/:id/pages/:n/figures', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限新增此簡報的圖表素材'));
    }
    const row = getFigurePageRow(id, n);
    if (!row) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    if (!request.isMultipart()) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    }

    let imageBytes: Buffer | null = null;
    let caption: string | undefined;
    let context: string | undefined;
    try {
      for await (const part of request.parts({ limits: { files: 1 } })) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file') {
            await part.toBuffer();
            continue;
          }
          imageBytes = await part.toBuffer();
        } else if (part.fieldname === 'caption' && typeof part.value === 'string') {
          caption = part.value;
        } else if (part.fieldname === 'context' && typeof part.value === 'string') {
          context = part.value;
        }
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT') {
        return reply.code(413).send(errorResponse('FILE_TOO_LARGE', '圖片超過大小或張數上限'));
      }
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Failed to parse multipart request'));
    }
    if (!imageBytes?.length) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Missing file field'));
    if ((caption?.length ?? 0) > MAX_FIGURE_CAPTION_CHARS || (context?.length ?? 0) > MAX_FIGURE_CONTEXT_CHARS) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'caption or context is too long'));
    }

    try {
      const figure = await addPageFigure(id, n, imageBytes, { caption, context });
      return reply.code(201).send({
        page_number: n,
        figure: {
          id: figure.id,
          caption: figure.caption,
          context: figure.context,
          bbox: figure.bbox,
          source: figure.source,
          image_url: `api/pdfs/${id}/figures/${encodeURIComponent(figure.id)}/image`,
          excluded: false,
        },
        created_at: nowIso(),
      });
    } catch (err) {
      request.log.warn({ err, pdfId: id, pageNumber: n }, 'Failed to register uploaded page figure');
      return reply.code(400).send(errorResponse('INVALID_IMAGE', '無法讀取圖片；請上傳支援的圖片格式'));
    }
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
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
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
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的圖表圖片'));
    }
    const abs = figureImageAbsPath(id, figure);
    if (!fs.existsSync(abs)) {
      return reply.code(404).send(errorResponse('FIGURE_NOT_FOUND', 'Figure image file missing'));
    }
    return streamFile(reply, abs, 'image/png', 'public, max-age=300');
  });
}
