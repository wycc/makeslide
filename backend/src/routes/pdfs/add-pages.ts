import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAddPagesJob, startAddPagesFromPrompt } from '../../worker/addPagesFromPrompt';
import { IdParamSchema, errorResponse } from './shared';

const AddPagesFromPromptBodySchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(5, 'prompt 至少需要 5 個字')
    .max(2000, 'prompt 不可超過 2000 字'),
});

export async function registerAddPagesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/:id/add-pages-from-prompt', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = AddPagesFromPromptBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(
          errorResponse(
            'INVALID_REQUEST',
            parsedBody.error.issues[0]?.message ?? 'Invalid body',
          ),
        );
    }

    try {
      const state = await startAddPagesFromPrompt(
        parsedParams.data.id,
        parsedBody.data.prompt,
      );
      return reply.code(202).send(state);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'PDF_NOT_FOUND') {
        return reply
          .code(404)
          .send(errorResponse('PDF_NOT_FOUND', `PDF ${parsedParams.data.id} not found`));
      }
      if (code === 'PDF_NOT_READY') {
        return reply
          .code(409)
          .send(errorResponse('INVALID_STATE', 'PDF is not ready — cannot add pages'));
      }
      if (code === 'ADD_PAGES_JOB_ALREADY_RUNNING') {
        return reply
          .code(409)
          .send(errorResponse('INVALID_STATE', 'An add-pages job is already running for this deck'));
      }
      request.log.error({ err, pdfId: parsedParams.data.id }, 'Failed to start add-pages job');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to start add-pages job'));
    }
  });

  app.get('/api/pdfs/:id/add-pages-from-prompt/status', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const state = getAddPagesJob(parsedParams.data.id);
    if (!state) {
      return reply
        .code(404)
        .send(errorResponse('ADD_PAGES_JOB_NOT_FOUND', 'No add-pages job found for this deck'));
    }
    return reply.code(200).send(state);
  });
}
