import type { FastifyInstance } from 'fastify';
import { ShareTokenParamSchema, getShareToken, hasShareAccess } from './share';
import { canReadPdf, canEditPdf } from './permissions';
import { z } from 'zod';
import { db } from '../../db';
import { sessionSub } from '../auth';
import type { PdfRow } from '../../types';
import { safeJoinPdfPath } from '../../services/storage';
import {
  getPresentationFileHistory,
  getPresentationFileAtCommit,
  restorePresentationFile,
} from '../../services/presentationGit';
import { generatePageThumbnail } from '../../services/thumbnails';
import { errorResponse, nowIso, PageParamSchema } from './shared';
import { readMetadata, writeMetadata } from '../../services/storage';

const HASH_RE = /^[0-9a-f]{7,40}$/;

function getPageArtifactPaths(
  pdfId: string,
  pageNumber: number,
): { page_uid: string; image_path: string | null; script_path: string | null } | undefined {
  return db
    .prepare(`SELECT page_uid, image_path, script_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
    .get(pdfId, pageNumber) as
    | { page_uid: string; image_path: string | null; script_path: string | null }
    | undefined;
}

function getPdfPermissionRow(id: string): Pick<PdfRow, 'owner_sub' | 'visibility'> | undefined {
  return db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
    | Pick<PdfRow, 'owner_sub' | 'visibility'>
    | undefined;
}

export async function registerVersioningRoutes(app: FastifyInstance): Promise<void> {
  // --- GET history for a page's image ---
  app.get('/api/pdfs/:id/pages/:n/image/history', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!hasShareAccess(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的圖片版本歷史'));
    }
    const page = getPageArtifactPaths(id, n);
    if (!page?.image_path) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    const history = await getPresentationFileHistory(id, page.image_path);
    return reply.send({ history });
  });

  // --- GET history for a page's script ---
  app.get('/api/pdfs/:id/pages/:n/script/history', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!hasShareAccess(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的逐字稿版本歷史'));
    }
    const page = getPageArtifactPaths(id, n);
    if (!page?.script_path) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    const history = await getPresentationFileHistory(id, page.script_path);
    return reply.send({ history });
  });

  // --- GET script content at a specific commit ---
  app.get('/api/pdfs/:id/pages/:n/script/versions/:hash', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    const { hash = '' } = request.params as { hash?: string };
    if (!parsed.success || !HASH_RE.test(hash)) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid params'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!hasShareAccess(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的逐字稿版本內容'));
    }
    const page = getPageArtifactPaths(id, n);
    if (!page?.script_path) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    try {
      const buf = await getPresentationFileAtCommit(id, page.script_path, hash);
      reply.header('content-type', 'text/plain; charset=utf-8');
      return reply.send(buf.toString('utf8'));
    } catch {
      return reply.code(404).send(errorResponse('VERSION_NOT_FOUND', `Version ${hash} not found`));
    }
  });

  // --- GET image at a specific commit ---
  app.get('/api/pdfs/:id/pages/:n/image/versions/:hash', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    const { hash = '' } = request.params as { hash?: string };
    if (!parsed.success || !HASH_RE.test(hash)) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid params'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!hasShareAccess(request, id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的圖片版本內容'));
    }
    const page = getPageArtifactPaths(id, n);
    if (!page?.image_path) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    try {
      const buf = await getPresentationFileAtCommit(id, page.image_path, hash);
      reply.header('content-type', 'image/jpeg');
      reply.header('cache-control', 'no-store');
      return reply.send(buf);
    } catch {
      return reply.code(404).send(errorResponse('VERSION_NOT_FOUND', `Version ${hash} not found`));
    }
  });

  // --- POST restore image to a specific commit ---
  app.post('/api/pdfs/:id/pages/:n/image/restore/:hash', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    const { hash = '' } = request.params as { hash?: string };
    if (!parsed.success || !HASH_RE.test(hash)) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid params'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限還原此簡報的圖片版本'));
    }
    const page = getPageArtifactPaths(id, n);
    if (!page?.image_path) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    try {
      await restorePresentationFile(
        id,
        page.image_path,
        hash,
        `image: restore page ${n} to ${hash.slice(0, 7)}`,
      );
      // Regenerate thumbnail
      const absPath = safeJoinPdfPath(id, page.image_path);
      await generatePageThumbnail(id, page.page_uid, absPath);

      const now = nowIso();
      db.prepare(`UPDATE pages SET updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(now, id, n);
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);

      try {
        const meta = await readMetadata(id);
        if (meta) {
          meta.updated_at = now;
          await writeMetadata(id, meta);
        }
      } catch {
        // non-fatal
      }

      return reply.send({
        id,
        page_number: n,
        image_url: `api/pdfs/${id}/pages/${n}/image`,
        updated_at: now,
      });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n, hash }, 'Failed to restore image');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to restore image version'));
    }
  });

  // --- POST restore script to a specific commit ---
  app.post('/api/pdfs/:id/pages/:n/script/restore/:hash', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    const { hash = '' } = request.params as { hash?: string };
    if (!parsed.success || !HASH_RE.test(hash)) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid params'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限還原此簡報的逐字稿版本'));
    }
    const page = getPageArtifactPaths(id, n);
    if (!page?.script_path) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    try {
      await restorePresentationFile(
        id,
        page.script_path,
        hash,
        `script: restore page ${n} to ${hash.slice(0, 7)}`,
      );

      const now = nowIso();
      db.prepare(`UPDATE pages SET updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(now, id, n);
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);

      // Read restored script content to return to client
      const scriptContent = (await getPresentationFileAtCommit(id, page.script_path, hash)).toString('utf8');

      try {
        const meta = await readMetadata(id);
        if (meta) {
          meta.updated_at = now;
          await writeMetadata(id, meta);
        }
      } catch {
        // non-fatal
      }

      return reply.send({
        id,
        page_number: n,
        script: scriptContent,
        updated_at: now,
      });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n, hash }, 'Failed to restore script');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to restore script version'));
    }
  });
}
