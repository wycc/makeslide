import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../../db';
import { decodeSession, parseCookies } from '../auth';
import { removePdfDir } from '../../services/storage';
import type { PdfRow } from '../../types';
import { errorResponse, IdParamSchema } from './shared';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

export async function registerDeleteRoutes(app: FastifyInstance): Promise<void> {
  app.delete('/api/pdfs/:id', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_ID', 'Invalid pdf id'));
    }

    const { id } = parsed.data;
    const existing = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'>
      | undefined;
    if (!existing) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', 'PDF not found'));
    }
    if (!canEditPdf(sessionSub(request), existing)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限刪除此簡報'));
    }

    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
    await removePdfDir(id);

    return reply.code(204).send();
  });
}
