/**
 * POST /api/pdfs/:id/pages/:n/cutouts — box regions of the page's base image, cut each out into a
 * page figure, erase it from the base with the image-edit model, and add an `overlay-image`
 * animation effect per region so it can be revealed on the timeline (docs/page-elements.md §9).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toFile } from 'openai/uploads';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { errorResponse, PageParamSchema, replyIfLlmDisabled } from './shared';
import { sessionSub } from '../auth';
import { aclCtx, canEditPdf } from './permissions';
import { describeImageEditFailure, imageEditTimeoutMs, withImageProviderFailover } from './page-operations';
import { currentAccountId } from '../../services/accountContext';
import {
  CUTOUT_MODEL_HEIGHT,
  CUTOUT_MODEL_WIDTH,
  MAX_CUTOUT_REGIONS,
  MIN_CUTOUT_SIZE,
  cutoutPageRegions,
  type CutoutEraser,
} from '../../services/pageCutouts';

const RegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(MIN_CUTOUT_SIZE).max(1),
  h: z.number().min(MIN_CUTOUT_SIZE).max(1),
});

const BodySchema = z.object({
  regions: z.array(RegionSchema).min(1).max(MAX_CUTOUT_REGIONS),
  prompt: z.string().max(2000).optional(),
  animate: z.boolean().optional(),
});

/** The production eraser: the same image-edit call the React-slide text erase uses. */
export const imageEditCutoutEraser: CutoutEraser = async ({ source, mask, prompt }) => {
  const imageFile = await toFile(source, 'region.png', { type: 'image/png' });
  const maskFile = await toFile(mask, 'mask.png', { type: 'image/png' });
  const edited = await withImageProviderFailover(currentAccountId(), ({ client, model }) =>
    client.images.edit(
      { model, image: imageFile, mask: maskFile, prompt, size: `${CUTOUT_MODEL_WIDTH}x${CUTOUT_MODEL_HEIGHT}` },
      { timeout: imageEditTimeoutMs() },
    ));
  const b64 = edited.data?.[0]?.b64_json;
  if (!b64) throw new Error('Image edit returned an empty result while erasing a cut-out');
  return Buffer.from(b64, 'base64');
};

let eraserOverride: CutoutEraser | null = null;
/** Tests swap the model call for a deterministic stub. */
export function setCutoutEraserForTest(eraser: CutoutEraser | null): void {
  eraserOverride = eraser;
}

export async function registerPageCutoutRoutes(app: FastifyInstance): Promise<void> {
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
    if (!eraserOverride && replyIfLlmDisabled(reply)) return reply;

    try {
      const result = await cutoutPageRegions(
        { pdfId: id, pageNumber: n, pageUid: page.page_uid },
        page.image_path,
        body.data.regions,
        { eraser: eraserOverride ?? imageEditCutoutEraser, prompt: body.data.prompt, animate: body.data.animate },
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
        })),
        updated_at: updated?.updated_at ?? new Date().toISOString(),
      });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'cutout failed');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', describeImageEditFailure(err) ?? '剪下區域失敗'));
    }
  });
}
