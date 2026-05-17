import type { FastifyInstance } from 'fastify';
import { rollbackRegenerate, getRegenerateJob, requestCancelRegenerateJob, startRegenerateJob } from '../../worker/regenerate';
import { IdParamSchema, RegenerateBatchBodySchema, errorResponse } from './shared';

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
    try {
      const state = await startRegenerateJob(parsedParams.data.id, {
        scripts: parsedBody.data.scripts,
        audio: parsedBody.data.audio,
        images: parsedBody.data.images,
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
