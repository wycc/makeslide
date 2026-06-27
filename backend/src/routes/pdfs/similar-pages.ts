import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { sessionSub } from '../auth';
import { errorResponse } from './shared';
import { cosineSimilarity, parseEmbedding } from '../../services/embeddings';

const TOP_K = 5;
const MIN_SCORE = 0.3;

interface CandidateRow {
  pdf_id: string;
  page_number: number;
  pdf_title: string | null;
  embedding: string;
}

export async function registerSimilarPagesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/pdfs/:id/pages/:n/similar — top-K semantically similar pages from
  // the same owner's decks, using already-indexed embeddings (no new LLM calls).
  app.get('/api/pdfs/:id/pages/:n/similar', async (request, reply) => {
    const { id, n } = request.params as { id: string; n: string };
    const pageNumber = Number(n);
    if (!id || !Number.isInteger(pageNumber) || pageNumber < 1) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }

    const sub = sessionSub(request);
    if (!sub) return reply.code(401).send(errorResponse('UNAUTHORIZED', 'Login required'));

    const pdfRow = db.prepare(`SELECT owner_sub FROM pdfs WHERE id = ?`).get(id) as
      | { owner_sub: string | null }
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (pdfRow.owner_sub !== sub) return reply.code(403).send(errorResponse('FORBIDDEN', 'Access denied'));

    const pageRow = db
      .prepare(`SELECT page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, pageNumber) as { page_uid: string | null } | undefined;
    // `indexed` lets the client distinguish "page not indexed yet" (hide the
    // section) from "indexed but nothing similar" (show an empty-state hint).
    if (!pageRow?.page_uid) return reply.send({ similar: [], indexed: false });

    const targetRow = db
      .prepare(`SELECT embedding FROM page_embeddings WHERE id = ?`)
      .get(`${id}:${pageRow.page_uid}`) as { embedding: string } | undefined;
    if (!targetRow) return reply.send({ similar: [], indexed: false });

    // A corrupt/unusable target embedding can't be compared against anything;
    // treat it like "not indexed" so the client hides the section gracefully
    // instead of the route throwing a 500.
    const targetVec = parseEmbedding(targetRow.embedding);
    if (!targetVec) return reply.send({ similar: [], indexed: false });

    const candidates = db
      .prepare(
        `SELECT pe.pdf_id AS pdf_id, p.page_number AS page_number, pf.title AS pdf_title, pe.embedding AS embedding
           FROM page_embeddings pe
           JOIN pages p ON p.pdf_id = pe.pdf_id AND p.page_uid = pe.page_uid
           JOIN pdfs pf ON pf.id = pe.pdf_id
          WHERE pf.owner_sub = ?
            AND NOT (pe.pdf_id = ? AND p.page_number = ?)`,
      )
      .all(sub, id, pageNumber) as CandidateRow[];

    const similar = candidates
      .map((row) => {
        // Skip a candidate whose embedding is corrupt rather than failing the
        // whole request — one bad row in the user's corpus shouldn't break the
        // entire similar-pages panel.
        const vec = parseEmbedding(row.embedding);
        if (!vec) return null;
        return {
          pdf_id: row.pdf_id,
          page_number: row.page_number,
          pdf_title: row.pdf_title,
          score: Math.round(cosineSimilarity(targetVec, vec) * 1000) / 1000,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null && c.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    return reply.send({ similar, indexed: true });
  });
}
