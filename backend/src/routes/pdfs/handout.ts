import type { FastifyInstance } from 'fastify';
import { canReadPdf } from './permissions';
import path from 'node:path';
import { db } from '../../db';
import type { PageRow, PdfRow } from '../../types';
import { buildHandoutPdf, readTextIfExists } from '../../services/handoutPdf';
import { safeJoinPdfPath } from '../../services/storage';
import { sessionSub } from '../auth';
import { errorResponse, IdParamSchema } from './shared';

function safeFilename(input: string): string {
  const name = input.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return name || 'makeslide-handout';
}

export async function registerHandoutRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/handout.pdf', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));

    const row = db
      .prepare(`SELECT id, title, original_filename, owner_sub, visibility, page_count FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'title' | 'original_filename' | 'owner_sub' | 'visibility' | 'page_count'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canReadPdf(sessionSub(request), row)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載此簡報講義'));

    const pages = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
           FROM pages WHERE pdf_id = ? AND image_path IS NOT NULL ORDER BY page_number ASC`,
      )
      .all(parsed.data.id) as PageRow[];
    if (pages.length === 0) return reply.code(400).send(errorResponse('NO_PAGES', 'No rendered pages available for handout PDF'));

    const handoutPages = await Promise.all(
      pages.map(async (page) => {
        const scriptPath = page.script_path ? safeJoinPdfPath(parsed.data.id, page.script_path) : null;
        const textPath = page.text_path ? safeJoinPdfPath(parsed.data.id, page.text_path) : null;
        const script = (await readTextIfExists(scriptPath)) || (await readTextIfExists(textPath));
        return {
          pageNumber: page.page_number,
          imagePath: safeJoinPdfPath(parsed.data.id, page.image_path ?? ''),
          script,
        };
      }),
    );
    const title = row.title || row.original_filename || row.id;
    const pdf = await buildHandoutPdf(handoutPages, title);
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `attachment; filename="${safeFilename(path.basename(title, path.extname(title)))}-handout.pdf"`);
    reply.header('cache-control', 'no-store');
    return reply.send(pdf);
  });
}
