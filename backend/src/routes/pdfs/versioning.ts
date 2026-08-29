import type { FastifyInstance } from 'fastify';
import { ShareTokenParamSchema, getShareToken } from './share';
import { getPdfPermissionRow, canReadPdf, canEditPdf , aclCtx } from './permissions';
import { z } from 'zod';
import { db } from '../../db';
import { sessionSub } from '../auth';
import type { PdfRow } from '../../types';
import { safeJoinPdfPath } from '../../services/storage';
import { validateAndCompileReactSlide } from '../../services/reactSlide';
import { writeReactSlideForPage } from '../../services/reactSlidePage';
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

/**
 * Where the page's JSX lives, preferring the recorded path over the conventional one — they
 * diverge after a ZIP import, which regenerates page_uid while asset files keep their names.
 */
function reactSlideRelPath(pdfId: string, pageNumber: number): string | null {
  const row = db
    .prepare(`SELECT page_uid, react_slide_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
    .get(pdfId, pageNumber) as { page_uid: string; react_slide_path: string | null } | undefined;
  if (!row) return null;
  return row.react_slide_path ?? `pages/${row.page_uid}.slide.jsx`;
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
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
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
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
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
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
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

  /**
   * The React slide's source, which now holds every element edit.
   *
   * Before edits were written into the code there was nothing here worth versioning; now a
   * mis-click deletes an element for real, and this is the way back. Restoring recompiles, because
   * the stored `.slide.js` is what the sandbox actually runs — restoring only the source would
   * leave the page rendering the version the user just replaced.
   */
  app.get('/api/pdfs/:id/pages/:n/react-slide/history', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的頁面版本歷史'));
    }
    const relPath = reactSlideRelPath(id, n);
    if (!relPath) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    const history = await getPresentationFileHistory(id, relPath);
    return reply.send({ history });
  });

  app.get('/api/pdfs/:id/pages/:n/react-slide/versions/:hash', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    const { hash = '' } = request.params as { hash?: string };
    if (!parsed.success || !HASH_RE.test(hash)) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid params'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的頁面版本內容'));
    }
    const relPath = reactSlideRelPath(id, n);
    if (!relPath) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    try {
      const buf = await getPresentationFileAtCommit(id, relPath, hash);
      reply.header('content-type', 'text/plain; charset=utf-8');
      return reply.send(buf.toString('utf8'));
    } catch {
      return reply.code(404).send(errorResponse('VERSION_NOT_FOUND', `Version ${hash} not found`));
    }
  });

  app.post('/api/pdfs/:id/pages/:n/react-slide/restore/:hash', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    const { hash = '' } = request.params as { hash?: string };
    if (!parsed.success || !HASH_RE.test(hash)) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid params'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限還原此簡報的頁面版本'));
    }
    const row = db
      .prepare(`SELECT page_uid, react_slide_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { page_uid: string; react_slide_path: string | null } | undefined;
    const relPath = row?.react_slide_path ?? (row ? `pages/${row.page_uid}.slide.jsx` : null);
    if (!row || !relPath) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    try {
      const code = (await getPresentationFileAtCommit(id, relPath, hash)).toString('utf8');
      const validation = await validateAndCompileReactSlide(code);
      if (!validation.ok || !validation.compiled) {
        // An old version that no longer compiles is not restorable: it would leave the page
        // rendering nothing, with the working version already overwritten.
        return reply.code(422).send(errorResponse('REACT_SLIDE_INVALID', validation.message ?? 'Slide code is invalid'));
      }
      const now = nowIso();
      const stored = await writeReactSlideForPage(id, n, row.page_uid, code, validation.compiled, now);
      await restorePresentationFile(id, relPath, hash, `react slide: restore page ${n} to ${hash.slice(0, 7)}`);
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);
      return reply.send({ id, page_number: n, code: stored.code, compiled: stored.compiled, updated_at: now });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n, hash }, 'Failed to restore react slide');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to restore slide version'));
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
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
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
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
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
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
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
