import type { FastifyInstance } from 'fastify';
import { canReadPdf, aclCtx } from './permissions';
import { db } from '../../db';
import { sessionSub } from '../auth';
import type { PdfRow } from '../../types';
import { IdParamSchema, errorResponse } from './shared';
import { listAudioProgress } from '../../services/audioProgress';

export async function registerAudioProgressRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/pdfs/:id/audio-progress — the speech being synthesized for this deck right now
  // (services/audioProgress.ts). Polled by every place that waits on a voice.
  app.get('/api/pdfs/:id/audio-progress', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsedParams.data;
    const pdf = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdf) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canReadPdf(sessionSub(request), pdf, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報'));
    }
    reply.header('cache-control', 'no-store');
    return reply.send({ now: new Date().toISOString(), items: listAudioProgress(id) });
  });
}
