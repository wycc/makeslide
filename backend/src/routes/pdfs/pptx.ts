import type { FastifyInstance } from 'fastify';
import { canReadPdf } from './permissions';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
const PptxGenJS = require('pptxgenjs') as new () => any;
import { db } from '../../db';
import type { PageRow, PdfRow } from '../../types';
import { safeJoinPdfPath } from '../../services/storage';
import { sessionSub } from '../auth';
import { errorResponse, IdParamSchema } from './shared';

function safeFilename(input: string): string {
  const name = input.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return name || 'makeslide';
}

async function readTextIfExists(absPath: string | null): Promise<string | null> {
  if (!absPath) return null;
  try {
    return await fs.readFile(absPath, 'utf-8');
  } catch {
    return null;
  }
}

export async function registerPptxRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/slides.pptx', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));

    const row = db
      .prepare(`SELECT id, title, original_filename, owner_sub, visibility, page_count FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'title' | 'original_filename' | 'owner_sub' | 'visibility' | 'page_count'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canReadPdf(sessionSub(request), row)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載此簡報'));

    const pages = db
      .prepare(
        `SELECT pdf_id, page_number, image_path, script_path, text_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
           FROM pages WHERE pdf_id = ? AND image_path IS NOT NULL ORDER BY page_number ASC`,
      )
      .all(parsed.data.id) as PageRow[];
    if (pages.length === 0) return reply.code(400).send(errorResponse('NO_PAGES', 'No rendered pages available'));

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';

    for (const page of pages) {
      const imagePath = safeJoinPdfPath(parsed.data.id, page.image_path ?? '');
      const scriptPath = page.script_path ? safeJoinPdfPath(parsed.data.id, page.script_path) : null;
      const textPath = page.text_path ? safeJoinPdfPath(parsed.data.id, page.text_path) : null;
      const notes = (await readTextIfExists(scriptPath)) || (await readTextIfExists(textPath));

      const slide = pptx.addSlide();
      slide.addImage({ path: imagePath, x: 0, y: 0, w: '100%', h: '100%' });
      if (notes?.trim()) {
        slide.addNotes(notes.trim());
      }
    }

    const streamResult = await pptx.stream();
    const buf = Buffer.isBuffer(streamResult) ? streamResult : Buffer.from(streamResult as ArrayBuffer);
    const title = row.title || row.original_filename || row.id;
    const baseName = safeFilename(path.basename(title, path.extname(title)));

    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    reply.header('content-disposition', `attachment; filename="${baseName}.pptx"`);
    reply.header('cache-control', 'no-store');
    return reply.send(buf);
  });
}
