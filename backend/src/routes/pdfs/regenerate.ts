import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../../db';
import { decodeSession, parseCookies } from '../auth';
import type { PdfRow } from '../../types';
import { rollbackRegenerate, getRegenerateJob, requestCancelRegenerateJob, startRegenerateJob } from '../../worker/regenerate';
import { IdParamSchema, RegenerateBatchBodySchema, errorResponse } from './shared';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

function getPdfPermissionRow(id: string): Pick<PdfRow, 'owner_sub' | 'visibility'> | undefined {
  return db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
    | Pick<PdfRow, 'owner_sub' | 'visibility'>
    | undefined;
}

export async function registerRegenerateRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/:id/regenerate', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = RegenerateBatchBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }
    const pdfRow = getPdfPermissionRow(parsedParams.data.id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsedParams.data.id} not found`));
    }
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限重新生成此簡報'));
    }
    try {
      const state = await startRegenerateJob(parsedParams.data.id, {
        scripts: parsedBody.data.scripts,
        audio: parsedBody.data.audio,
        images: parsedBody.data.images,
        animations: parsedBody.data.animations,
        page_numbers: parsedBody.data.page_numbers,
      });
      return reply.code(202).send(state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start regenerate';
      if (msg === 'PDF_NOT_FOUND') {
        return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsedParams.data.id} not found`));
      }
      if (msg === 'REGENERATE_JOB_ALREADY_RUNNING' || msg === 'JOB_ALREADY_RUNNING') {
        return reply.code(409).send(errorResponse('INVALID_STATE', 'Regenerate job is already running'));
      }
      request.log.error({ err, pdfId: parsedParams.data.id }, 'Failed to start regenerate job');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to start regenerate job'));
    }
  });

  app.get('/api/pdfs/:id/regenerate/status', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const state = getRegenerateJob(parsedParams.data.id);
    if (!state) return reply.code(404).send(errorResponse('REGENERATE_JOB_NOT_FOUND', 'Regenerate job not found'));
    return reply.code(200).send(state);
  });

  app.post('/api/pdfs/:id/regenerate/cancel', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const pdfRow = getPdfPermissionRow(parsedParams.data.id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsedParams.data.id} not found`));
    }
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限取消此簡報的重新生成'));
    }
    try {
      const state = requestCancelRegenerateJob(parsedParams.data.id);
      if (!state) return reply.code(404).send(errorResponse('REGENERATE_JOB_NOT_FOUND', 'Regenerate job not found'));
      return reply.code(202).send(state);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'JOB_NOT_FOUND') {
        return reply.code(404).send(errorResponse('REGENERATE_JOB_NOT_FOUND', 'Regenerate job not found'));
      }
      if (code === 'JOB_NOT_ACTIVE') {
        return reply.code(409).send(errorResponse('INVALID_STATE', 'Regenerate job is not active'));
      }
      request.log.error({ err, pdfId: parsedParams.data.id }, 'Failed to cancel regenerate job');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to cancel regenerate job'));
    }
  });

  app.post('/api/pdfs/:id/regenerate/rollback', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const pdfRow = getPdfPermissionRow(parsedParams.data.id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsedParams.data.id} not found`));
    }
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限回滾此簡報'));
    }
    try {
      const result = await rollbackRegenerate(parsedParams.data.id);
      return reply.code(200).send(result);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'SNAPSHOT_NOT_FOUND') {
        return reply.code(404).send(errorResponse('SNAPSHOT_NOT_FOUND', 'No rollback snapshot found'));
      }
      if (code === 'JOB_STILL_RUNNING') {
        return reply.code(409).send(errorResponse('INVALID_STATE', 'Regenerate job is still running'));
      }
      request.log.error({ err, pdfId: parsedParams.data.id }, 'Failed to rollback regenerate');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to rollback regenerate'));
    }
  });
}
