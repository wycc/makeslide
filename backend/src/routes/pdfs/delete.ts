import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { removePdfDir } from '../../services/storage';
import { errorResponse, IdParamSchema } from './shared';

export async function registerDeleteRoutes(app: FastifyInstance): Promise<void> {
  app.delete('/api/pdfs/:id', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_ID', 'Invalid pdf id'));
    }

    const { id } = parsed.data;
    const existing = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as { id: string } | undefined;
    if (!existing) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', 'PDF not found'));
    }

    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
    await removePdfDir(id);

    return reply.code(204).send();
  });
}
