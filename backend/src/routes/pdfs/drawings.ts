import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { PageParamSchema, errorResponse, nowIso } from './shared';

const SaveDrawingBodySchema = z.object({
  drawing_json: z.string().max(2_000_000),
});

export async function registerDrawingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/pages/:n/drawing', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
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
    db.prepare(`DELETE FROM page_drawings WHERE pdf_id = ? AND page_number = ?`).run(id, n);
    return reply.code(204).send();
  });
}
