import type { FastifyInstance } from 'fastify';
import { canReadPdf } from './permissions';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../../db';
import type { PageRow, PdfRow } from '../../types';
import { safeJoinPdfPath, pageImagePath, pageAudioPath, pageScriptPath, pageTextPath, pagesDir } from '../../services/storage';
import { config } from '../../config';
import { sessionSub } from '../auth';
import { errorResponse } from './shared';

async function copyFileSafe(src: string, dest: string): Promise<boolean> {
  try {
    await fs.copyFile(src, dest);
    return true;
  } catch {
    return false;
  }
}

const FromPagesBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  pages: z
    .array(
      z.object({
        pdf_id: z.string().min(1).max(200),
        page_number: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(100),
});

interface PageSpec {
  pdf_id: string;
  page_number: number;
}

export async function registerFromPagesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/from-pages', async (request, reply) => {
    const sub = sessionSub(request);
    if (!sub) return reply.code(401).send(errorResponse('UNAUTHORIZED', 'Authentication required'));

    const parsed = FromPagesBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.message));

    const { title, pages: pageSpecs } = parsed.data;

    // Verify all requested pages exist and are accessible
    const resolvedPages: Array<PageSpec & { row: PageRow; pdfTitle: string | null }> = [];
    for (const spec of pageSpecs) {
      const pdfRow = db
        .prepare(`SELECT owner_sub, visibility, title FROM pdfs WHERE id = ?`)
        .get(spec.pdf_id) as (Pick<PdfRow, 'owner_sub' | 'visibility'> & { title: string | null }) | undefined;
      if (!pdfRow) return reply.code(404).send(errorResponse('NOT_FOUND', `PDF not found: ${spec.pdf_id}`));
      if (!canReadPdf(sub, pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', `Access denied: ${spec.pdf_id}`));

      const pageRow = db
        .prepare(`SELECT * FROM pages WHERE pdf_id = ? AND page_number = ?`)
        .get(spec.pdf_id, spec.page_number) as PageRow | undefined;
      if (!pageRow) return reply.code(404).send(errorResponse('NOT_FOUND', `Page not found: ${spec.pdf_id}#${spec.page_number}`));

      resolvedPages.push({ ...spec, row: pageRow, pdfTitle: pdfRow.title });
    }

    // Create new PDF record
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    const newTitle = title ?? `複習簡報 ${now.slice(0, 10)}`;

    db.prepare(
      `INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, visibility, created_at, updated_at)
       VALUES (?, ?, ?, 'ready', ?, ?, 'private', ?, ?)`,
    ).run(newId, newTitle, `${newId}.pdf`, resolvedPages.length, sub, now, now);

    // Create storage dir for new PDF
    const newPagesDir = pagesDir(newId);
    await fs.mkdir(path.join(config.storageRoot, newId), { recursive: true });
    await fs.mkdir(newPagesDir, { recursive: true });

    // Copy pages
    for (let i = 0; i < resolvedPages.length; i++) {
      const { pdf_id: srcPdfId, row: srcPage } = resolvedPages[i]!;
      const newPageNumber = i + 1;
      const newPageUid = crypto.randomUUID();
      const pageNow = new Date().toISOString();

      // Resolve source file paths
      const srcImage = srcPage.image_path
        ? safeJoinPdfPath(srcPdfId, srcPage.image_path)
        : pageImagePath(srcPdfId, srcPage.page_uid);
      const srcAudio = srcPage.audio_path
        ? safeJoinPdfPath(srcPdfId, srcPage.audio_path)
        : pageAudioPath(srcPdfId, srcPage.page_uid);
      const srcScript = srcPage.script_path
        ? safeJoinPdfPath(srcPdfId, srcPage.script_path)
        : pageScriptPath(srcPdfId, srcPage.page_uid);
      const srcText = srcPage.text_path
        ? safeJoinPdfPath(srcPdfId, srcPage.text_path)
        : pageTextPath(srcPdfId, srcPage.page_uid);

      // Destination paths use conventional names (relative paths in DB)
      const destImageRel = `pages/${newPageUid}.jpg`;
      const destAudioRel = `pages/${newPageUid}.m4a`;
      const destScriptRel = `pages/${newPageUid}.script.txt`;
      const destTextRel = `pages/${newPageUid}.text.txt`;

      const destImage = path.join(config.storageRoot, newId, destImageRel);
      const destAudio = path.join(config.storageRoot, newId, destAudioRel);
      const destScript = path.join(config.storageRoot, newId, destScriptRel);
      const destText = path.join(config.storageRoot, newId, destTextRel);

      const [hasCopiedImage, hasCopiedAudio, hasCopiedScript, hasCopiedText] = await Promise.all([
        copyFileSafe(srcImage, destImage),
        copyFileSafe(srcAudio, destAudio),
        copyFileSafe(srcScript, destScript),
        copyFileSafe(srcText, destText),
      ]);

      db.prepare(
        `INSERT INTO pages (pdf_id, page_number, page_uid, image_path, audio_path, script_path, text_path, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
      ).run(
        newId,
        newPageNumber,
        newPageUid,
        hasCopiedImage ? destImageRel : null,
        hasCopiedAudio ? destAudioRel : null,
        hasCopiedScript ? destScriptRel : null,
        hasCopiedText ? destTextRel : null,
        pageNow,
        pageNow,
      );
    }

    return reply.code(201).send({ id: newId, title: newTitle, pageCount: resolvedPages.length });
  });
}
