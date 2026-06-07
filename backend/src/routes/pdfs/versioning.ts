import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { db } from '../../db';
import {
  pageImagePath,
  pageScriptPath,
  pdfDir,
  safeJoinPdfPath,
} from '../../services/storage';
import {
  getPresentationFileHistory,
  getPresentationFileAtCommit,
  restorePresentationFile,
} from '../../services/presentationGit';
import { generatePageThumbnail } from '../../services/thumbnails';
import { errorResponse, nowIso, PageParamSchema } from './shared';
import { readMetadata, writeMetadata } from '../../services/storage';

const HASH_RE = /^[0-9a-f]{7,40}$/;

function pagePad(pageCount: number) {
  return pageCount > 999 ? 4 : 3;
}

export async function registerVersioningRoutes(app: FastifyInstance): Promise<void> {
  // --- GET history for a page's image ---
  app.get('/api/pdfs/:id/pages/:n/image/history', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const row = db
      .prepare(`SELECT page_count FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null } | undefined;
    if (!row?.page_count) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));

    const relPath = path.posix.join(
      'pages',
      `${String(n).padStart(pagePad(row.page_count), '0')}.jpg`,
    );
    const history = await getPresentationFileHistory(id, relPath);
    return reply.send({ history });
  });

  // --- GET history for a page's script ---
  app.get('/api/pdfs/:id/pages/:n/script/history', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const row = db
      .prepare(`SELECT page_count FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null } | undefined;
    if (!row?.page_count) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));

    const relPath = path.posix.join(
      'pages',
      `${String(n).padStart(pagePad(row.page_count), '0')}.script.txt`,
    );
    const history = await getPresentationFileHistory(id, relPath);
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
    const row = db
      .prepare(`SELECT page_count FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null } | undefined;
    if (!row?.page_count) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));

    const relPath = path.posix.join(
      'pages',
      `${String(n).padStart(pagePad(row.page_count), '0')}.script.txt`,
    );
    try {
      const buf = await getPresentationFileAtCommit(id, relPath, hash);
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
    const row = db
      .prepare(`SELECT page_count FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null } | undefined;
    if (!row?.page_count) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));

    const relPath = path.posix.join(
      'pages',
      `${String(n).padStart(pagePad(row.page_count), '0')}.jpg`,
    );
    try {
      const buf = await getPresentationFileAtCommit(id, relPath, hash);
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
    const row = db
      .prepare(`SELECT page_count FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null } | undefined;
    if (!row?.page_count) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));

    const relPath = path.posix.join(
      'pages',
      `${String(n).padStart(pagePad(row.page_count), '0')}.jpg`,
    );
    try {
      await restorePresentationFile(
        id,
        relPath,
        hash,
        `image: restore page ${n} to ${hash.slice(0, 7)}`,
      );
      // Regenerate thumbnail
      const absPath = safeJoinPdfPath(id, relPath);
      await generatePageThumbnail(id, n, row.page_count, absPath);

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
    const row = db
      .prepare(`SELECT page_count FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null } | undefined;
    if (!row?.page_count) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));

    const relPath = path.posix.join(
      'pages',
      `${String(n).padStart(pagePad(row.page_count), '0')}.script.txt`,
    );
    try {
      await restorePresentationFile(
        id,
        relPath,
        hash,
        `script: restore page ${n} to ${hash.slice(0, 7)}`,
      );

      const now = nowIso();
      db.prepare(`UPDATE pages SET updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(now, id, n);
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);

      // Read restored script content to return to client
      const scriptContent = (await getPresentationFileAtCommit(id, relPath, hash)).toString('utf8');

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
