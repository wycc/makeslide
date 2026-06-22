import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import { z } from 'zod';
import { db } from '../../db';
import { decodeSession, parseCookies } from '../auth';
import { pageScriptPath } from '../../services/storage';
import type { PdfRow } from '../../types';
import { errorResponse } from './shared';

const MAX_PDF_RESULTS = 20;
const MAX_PAGE_RESULTS = 20;
const MAX_SCAN_PDFS = 50;
const SNIPPET_RADIUS = 80;

const SearchQuerySchema = z.object({
  q: z.string().trim().min(2, '搜尋詞至少 2 字').max(100, '搜尋詞過長'),
});

interface PdfSearchRow {
  id: string;
  title: string | null;
  page_count: number | null;
  visibility: string;
  owner_sub: string | null;
}

interface PageScanRow {
  pdf_id: string;
  page_number: number;
  page_uid: string;
  pdf_title: string | null;
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

function extractSnippet(content: string, query: string): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerContent.indexOf(lowerQuery);
  if (idx === -1) return content.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(content.length, idx + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return prefix + content.slice(start, end) + suffix;
}

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/search', async (request, reply) => {
    const sub = sessionSub(request);
    const parsed = SearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('BAD_REQUEST', parsed.error.issues[0]?.message ?? '搜尋參數錯誤'));
    }
    const { q } = parsed.data;
    const likePattern = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;

    // --- PDF title search ---
    const pdfRows = db.prepare(`
      SELECT id, title, page_count, visibility, owner_sub
      FROM pdfs
      WHERE status = 'ready'
        AND (owner_sub = ? OR visibility IN ('public', 'public_editable'))
        AND (title LIKE ? ESCAPE '\\')
      ORDER BY updated_at DESC
      LIMIT ${MAX_PDF_RESULTS}
    `).all(sub ?? '__nobody__', likePattern) as PdfSearchRow[];

    const pdfMatches = pdfRows.map((row) => ({
      id: row.id,
      title: row.title,
      pageCount: row.page_count,
    }));

    // --- Page script search (owner only, to avoid heavy filesystem scan on public PDFs) ---
    const pageMatches: Array<{ pdfId: string; pdfTitle: string | null; pageNumber: number; snippet: string }> = [];

    if (sub) {
      const scanRows = db.prepare(`
        SELECT pg.pdf_id, pg.page_number, pg.page_uid, pf.title AS pdf_title
        FROM pages pg
        JOIN pdfs pf ON pf.id = pg.pdf_id
        WHERE pf.owner_sub = ?
          AND pf.status = 'ready'
          AND pg.script_path IS NOT NULL
        ORDER BY pf.updated_at DESC, pg.page_number ASC
        LIMIT ${MAX_SCAN_PDFS * 50}
      `).all(sub) as PageScanRow[];

      const lowerQuery = q.toLowerCase();
      for (const row of scanRows) {
        if (pageMatches.length >= MAX_PAGE_RESULTS) break;
        const fpath = pageScriptPath(row.pdf_id, row.page_uid);
        let content: string;
        try {
          content = fs.readFileSync(fpath, 'utf8');
        } catch {
          continue;
        }
        if (!content.toLowerCase().includes(lowerQuery)) continue;
        pageMatches.push({
          pdfId: row.pdf_id,
          pdfTitle: row.pdf_title,
          pageNumber: row.page_number,
          snippet: extractSnippet(content, q),
        });
      }
    }

    return reply.code(200).send({ pdfMatches, pageMatches });
  });
}
