import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../../db';
import { decodeSession, parseCookies } from '../auth';
import { errorResponse } from './shared';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

export async function registerEmbeddingStatsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/me/embedding-stats — semantic-index coverage for the logged-in
  // user: how many pages are indexed, across how many of their PDFs.
  app.get('/api/me/embedding-stats', async (request, reply) => {
    const sub = sessionSub(request);
    if (!sub) return reply.code(401).send(errorResponse('UNAUTHORIZED', 'Login required'));
    const row = db
      .prepare(
        `SELECT COUNT(*) AS indexed_pages, COUNT(DISTINCT pe.pdf_id) AS indexed_pdfs
         FROM page_embeddings pe
         JOIN pdfs p ON p.id = pe.pdf_id
         WHERE p.owner_sub = ?`,
      )
      .get(sub) as { indexed_pages: number; indexed_pdfs: number };
    return reply.send({
      indexed_pages: row.indexed_pages ?? 0,
      indexed_pdfs: row.indexed_pdfs ?? 0,
    });
  });
}
