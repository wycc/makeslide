import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { sessionSub } from '../auth';
import { removePdfDir } from '../../services/storage';
import { clearRegenerateJob } from '../../worker/regenerate';
import { clearAddPagesJob } from '../../worker/addPagesFromPrompt';
import { clearSyncSession } from './sync';
import type { PdfRow } from '../../types';
import { errorResponse, IdParamSchema } from './shared';

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  // Deleting a presentation is destructive and irreversible (DB row + all files on
  // disk are gone for good), unlike the content-editing endpoints that share this same
  // helper name in other route files. A `public_editable` presentation is meant to let
  // signed-in collaborators who are not the owner make changes — it was never meant to
  // let a fully anonymous request (no session cookie at all, sub === null) destroy the
  // whole presentation just because someone once turned on an editable share link.
  // Require at least an authenticated session before falling back to the
  // public_editable visibility check.
  return Boolean(sub) && row.visibility === 'public_editable';
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
    clearRegenerateJob(id);
    clearAddPagesJob(id);
    clearSyncSession(id);

    return reply.code(204).send();
  });
}
