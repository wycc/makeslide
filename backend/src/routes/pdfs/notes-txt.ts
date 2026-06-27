import type { FastifyInstance, FastifyRequest } from 'fastify';
import { canReadPdf } from './permissions';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { decodeSession, parseCookies } from '../auth';
import { errorResponse, IdParamSchema } from './shared';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

interface PageNoteRow {
  page_number: number;
  page_notes: string;
}

export async function registerNotesTxtRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/notes.txt', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));

    const { id } = parsed.data;
    const pdfRow = db
      .prepare(`SELECT id, title, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(id) as Pick<PdfRow, 'id' | 'title' | 'owner_sub' | 'visibility'> | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載此簡報的頁面備註'));
    }

    const pages = db
      .prepare(
        `SELECT page_number, COALESCE(page_notes, '') AS page_notes
           FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
      )
      .all(id) as PageNoteRow[];

    const chunks: string[] = [];
    for (const page of pages) {
      const note = page.page_notes.trim();
      if (note) {
        chunks.push(`=== 第 ${page.page_number} 頁 ===\n${note}`);
      }
    }

    const title = (pdfRow.title ?? id).replace(/[^\w一-鿿]/g, '_');
    const body = chunks.length > 0 ? chunks.join('\n\n') : '（無頁面備註）';

    void reply.header('Content-Type', 'text/plain; charset=utf-8');
    void reply.header('Content-Disposition', `attachment; filename="${title}_notes.txt"`);
    return reply.send(body);
  });
}
