import fs from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { pageTextPath, pageScriptPath } from '../../services/storage';
import { decodeSession, parseCookies } from '../auth';
import type { PdfRow } from '../../types';

const MAX_READABLE_PDFS = 100;
const MAX_PAGE_RESULTS_PER_PDF = 3;
const SNIPPET_CONTEXT = 60;

const SearchQuerySchema = z.object({
  q: z.string().min(1, 'q is required').max(100, 'q must be at most 100 characters'),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

interface SearchResult {
  pdf_id: string;
  pdf_title: string | null;
  page_number: number | null;
  match_type: 'title' | 'script' | 'text';
  snippet: string;
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

function extractSnippet(content: string, keyword: string): string {
  const lowerContent = content.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const idx = lowerContent.indexOf(lowerKeyword);
  if (idx === -1) return '';

  const start = Math.max(0, idx - SNIPPET_CONTEXT);
  const end = Math.min(content.length, idx + lowerKeyword.length + SNIPPET_CONTEXT);

  let snippet = content.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  return snippet;
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

    const { q, limit } = parsed.data;
    const keyword = q.toLowerCase();

    const sub = sessionSub(request);

    // Fetch readable PDFs — capped at MAX_READABLE_PDFS, ordered by newest first.
    // We fetch more than MAX_READABLE_PDFS upfront to account for permission filtering.
    const allPdfs = db
      .prepare(
        `SELECT id, title, owner_sub, visibility, created_at
         FROM pdfs
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(MAX_READABLE_PDFS * 10) as Array<Pick<PdfRow, 'id' | 'title' | 'owner_sub' | 'visibility'> & { created_at: string }>;

    const readablePdfs = allPdfs
      .filter((row) => canReadPdf(sub, row))
      .slice(0, MAX_READABLE_PDFS);

    const results: SearchResult[] = [];

    for (const pdf of readablePdfs) {
      if (results.length >= limit) break;

      // 1. Title match
      const titleLower = (pdf.title ?? '').toLowerCase();
      if (titleLower.includes(keyword)) {
        const snippet = extractSnippet(pdf.title ?? '', q);
        results.push({
          pdf_id: pdf.id,
          pdf_title: pdf.title ?? null,
          page_number: null,
          match_type: 'title',
          snippet,
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
          // Check script file first (逐字稿)
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

          // Then check text file (頁面文字)
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
