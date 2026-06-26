import fs from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { pageTextPath, pageScriptPath } from '../../services/storage';
import { extractSnippet } from './searchSnippet';
import { decodeSession, parseCookies } from '../auth';
import type { PdfRow } from '../../types';
import { getOrCreateEmbeddings, embedQuery, cosineSimilarity } from '../../services/embeddings';
import { logger } from '../../logger';

const MAX_READABLE_PDFS = 100;
const MAX_PAGE_RESULTS_PER_PDF = 3;
const MAX_SEMANTIC_PDFS = 20;
const SEMANTIC_TOP_K = 20;

const SearchQuerySchema = z.object({
  q: z.string().min(1, 'q is required').max(100, 'q must be at most 100 characters'),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  semantic: z.string().optional(),
});

interface SearchResult {
  pdf_id: string;
  pdf_title: string | null;
  page_number: number | null;
  match_type: 'title' | 'description' | 'script' | 'text' | 'semantic';
  snippet: string;
  score?: number;
}

interface SearchPageRow {
  pdf_id: string;
  page_number: number;
  page_uid: string;
  text_path: string | null;
  script_path: string | null;
}

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}


function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/search', async (request, reply) => {
    const parsed = SearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.errors[0]?.message ?? 'Invalid query' } });
    }

    const { q, limit, semantic } = parsed.data;
    const isSemanticMode = semantic === 'true' || semantic === '1';
    const sub = sessionSub(request);

    // --- Semantic search path ---
    if (isSemanticMode) {
      if (!sub) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Semantic search requires authentication' } });
      }

      // Only search own PDFs (need API key, limit API cost)
      const ownPdfs = db
        .prepare(
          `SELECT id, title FROM pdfs WHERE owner_sub = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(sub, MAX_SEMANTIC_PDFS) as Array<Pick<PdfRow, 'id' | 'title'>>;

      if (ownPdfs.length === 0) {
        return reply.send({ query: q, results: [], semantic: true });
      }

      // Collect all pages with script content
      const entries: Array<{
        id: string;
        pdf_id: string;
        pdf_title: string | null;
        page_uid: string;
        page_number: number;
        text: string;
      }> = [];

      for (const pdf of ownPdfs) {
        const pages = db
          .prepare(`SELECT pdf_id, page_number, page_uid FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
          .all(pdf.id) as Array<Pick<SearchPageRow, 'pdf_id' | 'page_number' | 'page_uid'>>;

        for (const page of pages) {
          if (!page.page_uid) continue;
          const script = readFileOrNull(pageScriptPath(page.pdf_id, page.page_uid));
          if (script && script.trim().length > 10) {
            entries.push({
              id: `${page.pdf_id}:${page.page_uid}`,
              pdf_id: page.pdf_id,
              pdf_title: pdf.title ?? null,
              page_uid: page.page_uid,
              page_number: page.page_number,
              text: script,
            });
          }
        }
      }

      if (entries.length === 0) {
        return reply.send({ query: q, results: [], semantic: true });
      }

      try {
        // Embed query and all page content in parallel (embeddings are cached)
        const [queryVec, embeddingMap] = await Promise.all([
          embedQuery(q, sub),
          getOrCreateEmbeddings(
            entries.map((e) => ({ id: e.id, pdf_id: e.pdf_id, page_uid: e.page_uid, text: e.text })),
            sub,
          ),
        ]);

        // Score and rank
        const scored = entries
          .map((e) => {
            const vec = embeddingMap.get(e.id);
            const score = vec ? cosineSimilarity(queryVec, vec) : 0;
            return { ...e, score };
          })
          .filter((e) => e.score > 0.3)
          .sort((a, b) => b.score - a.score)
          .slice(0, SEMANTIC_TOP_K);

        const results: SearchResult[] = scored.map((e) => ({
          pdf_id: e.pdf_id,
          pdf_title: e.pdf_title,
          page_number: e.page_number,
          match_type: 'semantic' as const,
          snippet: extractSnippet(e.text, q),
          score: Math.round(e.score * 1000) / 1000,
        }));

        return reply.send({ query: q, results: results.slice(0, limit), semantic: true });
      } catch (err) {
        logger.warn({ err }, 'Semantic search failed, falling back to keyword search');
        // Fall through to keyword search below
      }
    }

    // --- Keyword search path ---
    const keyword = q.toLowerCase();

    const allPdfs = db
      .prepare(
        `SELECT id, title, description, owner_sub, visibility, created_at
         FROM pdfs
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(MAX_READABLE_PDFS * 10) as Array<Pick<PdfRow, 'id' | 'title' | 'owner_sub' | 'visibility'> & { created_at: string; description?: string }>;

    const readablePdfs = allPdfs
      .filter((row) => canReadPdf(sub, row))
      .slice(0, MAX_READABLE_PDFS);

    const results: SearchResult[] = [];

    for (const pdf of readablePdfs) {
      if (results.length >= limit) break;

      // 1. Title match
      const titleLower = (pdf.title ?? '').toLowerCase();
      if (titleLower.includes(keyword)) {
        results.push({
          pdf_id: pdf.id,
          pdf_title: pdf.title ?? null,
          page_number: null,
          match_type: 'title',
          snippet: extractSnippet(pdf.title ?? '', q),
        });
      }

      if (results.length >= limit) break;

      // 1b. Description match
      const descriptionLower = (pdf.description ?? '').toLowerCase();
      if (descriptionLower.includes(keyword)) {
        results.push({
          pdf_id: pdf.id,
          pdf_title: pdf.title ?? null,
          page_number: null,
          match_type: 'description',
          snippet: extractSnippet(pdf.description ?? '', q),
        });
      }

      if (results.length >= limit) break;

      // 2. Page text / script match
      const pages = db
        .prepare(
          `SELECT pdf_id, page_number, page_uid, text_path, script_path
           FROM pages
           WHERE pdf_id = ?
           ORDER BY page_number ASC`,
        )
        .all(pdf.id) as SearchPageRow[];

      let pageResultCount = 0;

      for (const page of pages) {
        if (results.length >= limit) break;
        if (pageResultCount >= MAX_PAGE_RESULTS_PER_PDF) break;

        if (page.page_uid) {
          const scriptContent = readFileOrNull(pageScriptPath(pdf.id, page.page_uid));
          if (scriptContent && scriptContent.toLowerCase().includes(keyword)) {
            results.push({
              pdf_id: pdf.id,
              pdf_title: pdf.title ?? null,
              page_number: page.page_number,
              match_type: 'script',
              snippet: extractSnippet(scriptContent, q),
            });
            pageResultCount++;
            continue;
          }

          const textContent = readFileOrNull(pageTextPath(pdf.id, page.page_uid));
          if (textContent && textContent.toLowerCase().includes(keyword)) {
            results.push({
              pdf_id: pdf.id,
              pdf_title: pdf.title ?? null,
              page_number: page.page_number,
              match_type: 'text',
              snippet: extractSnippet(textContent, q),
            });
            pageResultCount++;
          }
        }
      }
    }

    return reply.send({ query: q, results: results.slice(0, limit) });
  });
}
