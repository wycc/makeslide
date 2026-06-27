import type { FastifyInstance } from 'fastify';
import { canReadPdf } from './permissions';
import fs from 'node:fs/promises';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { sessionSub } from '../auth';
import { pageScriptPath, pageTextPath, safeJoinPdfPath } from '../../services/storage';
import { errorResponse, IdParamSchema } from './shared';

interface PageRow {
  page_number: number;
  page_uid: string;
  script_path: string | null;
  text_path: string | null;
}

async function readTextSafe(filePath: string | null): Promise<string> {
  if (!filePath) return '';
  try { return (await fs.readFile(filePath, 'utf8')).trim(); } catch { return ''; }
}

export async function registerScriptsTxtRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/scripts.txt', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));

    const { id } = parsed.data;
    const pdfRow = db
      .prepare(`SELECT id, title, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(id) as Pick<PdfRow, 'id' | 'title' | 'owner_sub' | 'visibility'> | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載此簡報的逐字稿'));
    }

    const pages = db
      .prepare(
        `SELECT page_number, page_uid, script_path, text_path
           FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
      )
      .all(id) as PageRow[];

    const chunks: string[] = [];
    for (const page of pages) {
      const scriptAbs = page.script_path ? safeJoinPdfPath(id, page.script_path) : pageScriptPath(id, page.page_uid);
      const textAbs = page.text_path ? safeJoinPdfPath(id, page.text_path) : pageTextPath(id, page.page_uid);
      const text = (await readTextSafe(scriptAbs)) || (await readTextSafe(textAbs));
      chunks.push(`=== 第 ${page.page_number} 頁 ===\n${text || '（無逐字稿）'}`);
    }

    const title = (pdfRow.title ?? id).replace(/[^\w一-鿿]/g, '_');
    const body = chunks.join('\n\n');

    void reply.header('Content-Type', 'text/plain; charset=utf-8');
    void reply.header('Content-Disposition', `attachment; filename="${title}_scripts.txt"`);
    return reply.send(body);
  });
}
