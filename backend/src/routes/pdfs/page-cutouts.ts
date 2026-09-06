/**
 * POST /api/pdfs/:id/pages/:n/cutouts — box regions of the page's base image, cut each out into a
 * page figure, erase it from the base with the image-edit model, and add an `overlay-image`
 * animation effect per region so it can be revealed on the timeline (docs/page-elements.md §9).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { errorResponse, PageParamSchema, replyIfLlmDisabled } from './shared';
import { sessionSub } from '../auth';
import { aclCtx, canEditPdf, canReadPdf } from './permissions';
import { describeImageEditFailure } from './page-operations';
import { cutoutEraserOverridden, resolveCutoutDeps } from '../../services/cutoutDeps';
import { detectCutoutCandidates } from '../../services/cutoutDetect';
import { cutoutSourcePath } from '../../services/pageCutouts';
import { splitScriptIntoSentences } from '../../services/textSentences';
import { safeJoinPdfPath } from '../../services/storage';
import fs from 'node:fs';
import { MAX_CUTOUT_REGIONS, MIN_CUTOUT_SIZE, applyCutoutChanges, cutoutPageRegions, hideCutout, listCutouts } from '../../services/pageCutouts';

const RegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(MIN_CUTOUT_SIZE).max(1),
  h: z.number().min(MIN_CUTOUT_SIZE).max(1),
  label: z.string().trim().max(120).optional(),
});

const ApplyBodySchema = z.object({
  restore: z.array(z.string().min(1).max(200)).max(40).default([]),
  cut: z.array(RegionSchema).max(MAX_CUTOUT_REGIONS).default([]),
  prompt: z.string().max(2000).optional(),
  animate: z.boolean().optional(),
});

const HiddenBodySchema = z.object({ hidden: z.boolean() });

const DetectBodySchema = z.object({
  /** Skip the model grouping step (default false). */
  raw: z.boolean().optional(),
});

const BodySchema = z.object({
  regions: z.array(RegionSchema).min(1).max(MAX_CUTOUT_REGIONS),
  prompt: z.string().max(2000).optional(),
  animate: z.boolean().optional(),
});

// Test hooks live with the shared deps so the batch regenerate step honours them too.
export { setCutoutEraserForTest, setCutoutPlacerForTest, setCutoutRefinerForTest } from '../../services/cutoutDeps';

export async function registerPageCutoutRoutes(app: FastifyInstance): Promise<void> {
  // Proposes regions (docs/page-elements.md §9.6): image analysis, then — when an LLM is
  // configured — the model groups and labels the candidates. Nothing is written.
  app.post('/api/pdfs/:id/pages/:n/cutouts/detect', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const { id, n } = parsed.data;
    const body = DetectBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as { owner_sub: string | null; visibility: PdfRow['visibility'] } | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
    const page = db
      .prepare(`SELECT page_uid, render_type, image_path, script_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { page_uid: string; render_type: string | null; image_path: string | null; script_path: string | null } | undefined;
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    if (page.render_type === 'react' || page.render_type === 'notebook') {
      return reply.code(409).send(errorResponse('INVALID_STATE', '此頁面型別沒有底圖可以剪下'));
    }
    try {
      const sourcePath = cutoutSourcePath({ pdfId: id, pageNumber: n, pageUid: page.page_uid }, page.image_path);
      const image = await fs.promises.readFile(sourcePath);
      const candidates = await detectCutoutCandidates(image);
      let regions = candidates;
      let refined = false;
      const { refiner } = resolveCutoutDeps();
      if (refiner && !body.data.raw && candidates.length > 0) {
        try {
          let sentences: string[] = [];
          if (page.script_path) {
            try {
              sentences = splitScriptIntoSentences(await fs.promises.readFile(safeJoinPdfPath(id, page.script_path), 'utf8'));
            } catch {
              sentences = [];
            }
          }
          regions = await refiner({ image, candidates, sentences });
          refined = true;
        } catch (err) {
          request.log.warn({ err, pdfId: id, pageNumber: n }, 'cutout detect: refinement failed, returning raw candidates');
        }
      }
      return reply.code(200).send({ id, page_number: n, regions, candidates: candidates.length, refined });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'cutout detect failed');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', '自動偵測區域失敗'));
    }
  });

  // The page's cut-outs with their state (docs/page-elements.md §9.9).
  app.get('/api/pdfs/:id/pages/:n/cutouts', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const { id, n } = parsed.data;
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as { owner_sub: string | null; visibility: PdfRow['visibility'] } | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報'));
    const page = db.prepare(`SELECT page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n) as { page_uid: string } | undefined;
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    return reply.code(200).send({ id, page_number: n, cuts: listCutouts({ pdfId: id, pageNumber: n, pageUid: page.page_uid }) });
  });

  // Hide / show one cut-out's overlay — immediate, no picture work.
  app.patch('/api/pdfs/:id/pages/:n/cutouts/:figureId', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    const figureId = (request.params as { figureId?: string }).figureId ?? '';
    if (!parsed.success || !/^[A-Za-z0-9_-]{1,200}$/.test(figureId)) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id, page number or figure id'));
    }
    const body = HiddenBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid body'));
    const { id, n } = parsed.data;
    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as { owner_sub: string | null; visibility: PdfRow['visibility'] } | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    const page = db.prepare(`SELECT page_uid, image_path FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n) as { page_uid: string; image_path: string | null } | undefined;
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    try {
      const cuts = await hideCutout({ pdfId: id, pageNumber: n, pageUid: page.page_uid }, page.image_path, figureId, body.data.hidden);
      return reply.code(200).send({ id, page_number: n, cuts });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n, figureId }, 'cutout hide/show failed');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', '切換顯示失敗'));
    }
  });

  // One batch of edits: restore some cut-outs, cut new regions — the base is written once.
  app.post('/api/pdfs/:id/pages/:n/cutouts/apply', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const { id, n } = parsed.data;
    const body = ApplyBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    if (body.data.restore.length === 0 && body.data.cut.length === 0) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Nothing to apply'));
    }
    const pdfRow = db.prepare(`SELECT owner_sub, visibility, page_count FROM pdfs WHERE id = ?`).get(id) as
      | { owner_sub: string | null; visibility: PdfRow['visibility']; page_count: number | null }
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    const page = db
      .prepare(`SELECT page_uid, render_type, image_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { page_uid: string; render_type: string | null; image_path: string | null } | undefined;
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    if (page.render_type === 'react' || page.render_type === 'notebook') {
      return reply.code(409).send(errorResponse('INVALID_STATE', '此頁面型別沒有底圖可以剪下'));
    }
    if (body.data.cut.length > 0 && !cutoutEraserOverridden() && replyIfLlmDisabled(reply)) return reply;
    try {
      const result = await applyCutoutChanges(
        { pdfId: id, pageNumber: n, pageUid: page.page_uid },
        page.image_path,
        { restore: body.data.restore, cut: body.data.cut },
        { ...resolveCutoutDeps(), prompt: body.data.prompt, animate: body.data.animate },
      );
      const updated = db.prepare(`SELECT updated_at FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n) as { updated_at: string } | undefined;
      return reply.code(200).send({
        id,
        page_number: n,
        render_type: result.renderType,
        results: result.results.map((r) => ({
          index: r.index,
          status: r.status,
          message: r.message ?? null,
          figure_id: r.figure?.id ?? null,
          effect_id: r.effectId ?? null,
          line: r.line ?? null,
          sentence: r.sentence ?? null,
          reveal: r.reveal ?? null,
          params: r.params ?? null,
        })),
        restored: result.restored,
        cuts: result.cuts,
        updated_at: updated?.updated_at ?? new Date().toISOString(),
      });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'cutout apply failed');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', describeImageEditFailure(err) ?? '套用剪下變更失敗'));
    }
  });

  app.post('/api/pdfs/:id/pages/:n/cutouts', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const { id, n } = parsed.data;
    const body = BodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));

    const pdfRow = db.prepare(`SELECT owner_sub, visibility, page_count FROM pdfs WHERE id = ?`).get(id) as
      | { owner_sub: string | null; visibility: PdfRow['visibility']; page_count: number | null }
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
    const page = db
      .prepare(`SELECT page_uid, render_type, image_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { page_uid: string; render_type: string | null; image_path: string | null } | undefined;
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    if (page.render_type === 'react' || page.render_type === 'notebook') {
      return reply.code(409).send(errorResponse('INVALID_STATE', '此頁面型別沒有底圖可以剪下'));
    }
    if (!cutoutEraserOverridden() && replyIfLlmDisabled(reply)) return reply;

    try {
      const result = await cutoutPageRegions(
        { pdfId: id, pageNumber: n, pageUid: page.page_uid },
        page.image_path,
        body.data.regions,
        { ...resolveCutoutDeps(), prompt: body.data.prompt, animate: body.data.animate },
      );
      const failed = result.results.filter((r) => r.status === 'failed');
      if (!result.baseUpdated) {
        const first = failed[0];
        return reply.code(502).send(
          errorResponse('CUTOUT_FAILED', describeImageEditFailure(new Error(first?.message ?? 'cut-out failed')) ?? first?.message ?? '剪下失敗'),
        );
      }
      const updated = db.prepare(`SELECT updated_at FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n) as { updated_at: string } | undefined;
      return reply.code(200).send({
        id,
        page_number: n,
        render_type: result.renderType,
        results: result.results.map((r) => ({
          index: r.index,
          status: r.status,
          message: r.message ?? null,
          figure_id: r.figure?.id ?? null,
          effect_id: r.effectId ?? null,
          line: r.line ?? null,
          sentence: r.sentence ?? null,
          reveal: r.reveal ?? null,
          params: r.params ?? null,
        })),
        updated_at: updated?.updated_at ?? new Date().toISOString(),
      });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'cutout failed');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', describeImageEditFailure(err) ?? '剪下區域失敗'));
    }
  });
}
