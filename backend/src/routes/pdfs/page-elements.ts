/**
 * Page element layer routes (docs/page-elements.md §4).
 *
 *   GET  /api/pdfs/:id/pages/:n/elements               — the element list
 *   PUT  /api/pdfs/:id/pages/:n/elements               — save + compose
 *   POST /api/pdfs/:id/pages/:n/elements/assets        — upload an image asset
 *   GET  /api/pdfs/:id/pages/:n/elements/assets/:name  — read an image asset
 *   GET  /api/pdfs/:id/pages/:n/base-image             — the base image (page image when no elements)
 */
import fs from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { z } from 'zod';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { errorResponse, PageParamSchema, streamFile } from './shared';
import { sessionSub } from '../auth';
import { aclCtx, canEditPdf, canReadPdf } from './permissions';
import { pageBaseImagePath, pageElementAssetPath, pageImagePath, safeJoinPdfPath } from '../../services/storage';
import {
  ELEMENT_ASSET_NAME_RE,
  MAX_ELEMENT_ASSET_BYTES,
  MAX_ELEMENT_ASSET_EDGE_PX,
  PageElementsArraySchema,
  PageElementsError,
  readPageElementsSync,
  resolvePageAssetPath,
  savePageElements,
} from '../../services/pageElements';

interface PageLookup {
  pdf: { owner_sub: string | null; visibility: PdfRow['visibility']; page_count: number | null };
  page: { page_uid: string; render_type: string | null; image_path: string | null; updated_at: string };
}

const PutBodySchema = z.object({ elements: PageElementsArraySchema });

function lookup(id: string, n: number): PageLookup | null {
  const pdf = db.prepare(`SELECT owner_sub, visibility, page_count FROM pdfs WHERE id = ?`).get(id) as PageLookup['pdf'] | undefined;
  if (!pdf) return null;
  const page = db
    .prepare(`SELECT page_uid, render_type, image_path, updated_at FROM pages WHERE pdf_id = ? AND page_number = ?`)
    .get(id, n) as PageLookup['page'] | undefined;
  if (!page) return null;
  return { pdf, page };
}

function assetMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

export async function registerPageElementsRoutes(app: FastifyInstance): Promise<void> {
  const readGuard = (request: FastifyRequest, id: string, found: PageLookup) =>
    canReadPdf(sessionSub(request), found.pdf, aclCtx(request, id));
  const editGuard = (request: FastifyRequest, id: string, found: PageLookup) =>
    canEditPdf(sessionSub(request), found.pdf, aclCtx(request, id));

  app.get('/api/pdfs/:id/pages/:n/elements', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const { id, n } = parsed.data;
    const found = lookup(id, n);
    if (!found) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    if (!readGuard(request, id, found)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報'));
    return reply.code(200).send({
      id,
      page_number: n,
      elements: readPageElementsSync(id, found.page.page_uid),
      updated_at: found.page.updated_at,
    });
  });

  app.put('/api/pdfs/:id/pages/:n/elements', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const { id, n } = parsed.data;
    const found = lookup(id, n);
    if (!found) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    if (!editGuard(request, id, found)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    // React and notebook pages draw their picture from code / a document; there is no base image
    // to place anything on (docs/page-elements.md §1.1).
    if (found.page.render_type === 'react' || found.page.render_type === 'notebook') {
      return reply.code(409).send(errorResponse('INVALID_STATE', '此頁面型別不支援元素層'));
    }
    const body = PutBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid elements'));
    }
    try {
      const result = await savePageElements({ pdfId: id, pageNumber: n, pageUid: found.page.page_uid }, body.data.elements);
      return reply.code(200).send({ id, page_number: n, ...result });
    } catch (err) {
      if (err instanceof PageElementsError) {
        const status = err.code === 'RENDER_FAILED' ? 500 : err.code === 'NO_BASE_IMAGE' ? 409 : 400;
        return reply.code(status).send(errorResponse(err.code, err.message));
      }
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to save page elements');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to save page elements'));
    }
  });

  app.post('/api/pdfs/:id/pages/:n/elements/assets', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    if (!request.isMultipart()) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    const { id, n } = parsed.data;
    const found = lookup(id, n);
    if (!found) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    if (!editGuard(request, id, found)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));

    const file = await request.file({ limits: { fileSize: MAX_ELEMENT_ASSET_BYTES } });
    if (!file) return reply.code(400).send(errorResponse('NO_FILE', 'No file field found'));
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      return reply.code(413).send(errorResponse('FILE_TOO_LARGE', `圖片不可超過 ${MAX_ELEMENT_ASSET_BYTES / 1024 / 1024} MB`));
    }
    if (buf.length > MAX_ELEMENT_ASSET_BYTES) {
      return reply.code(413).send(errorResponse('FILE_TOO_LARGE', `圖片不可超過 ${MAX_ELEMENT_ASSET_BYTES / 1024 / 1024} MB`));
    }

    // The extension is not evidence: decode it. SVG is refused outright (it can carry script and
    // the browser layer renders assets with <img>).
    let meta: sharp.Metadata;
    try {
      meta = await sharp(buf, { animated: false }).metadata();
    } catch {
      return reply.code(400).send(errorResponse('INVALID_MIME', 'Image must be decodable'));
    }
    const format = meta.format;
    const ext = format === 'png' ? 'png' : format === 'jpeg' ? 'jpg' : format === 'webp' ? 'webp' : format === 'gif' ? 'gif' : null;
    if (!ext || !meta.width || !meta.height) {
      return reply.code(400).send(errorResponse('INVALID_MIME', 'Only PNG, JPEG, WebP and GIF images are accepted'));
    }
    let width = meta.width;
    let height = meta.height;
    let bytes = buf;
    if (Math.max(width, height) > MAX_ELEMENT_ASSET_EDGE_PX) {
      const resized = sharp(buf).resize(MAX_ELEMENT_ASSET_EDGE_PX, MAX_ELEMENT_ASSET_EDGE_PX, { fit: 'inside', withoutEnlargement: true });
      bytes = await (ext === 'png' ? resized.png() : ext === 'webp' ? resized.webp() : ext === 'gif' ? resized.png() : resized.jpeg({ quality: 88 })).toBuffer();
      const after = await sharp(bytes).metadata();
      width = after.width ?? width;
      height = after.height ?? height;
    }
    const finalExt = ext === 'gif' && bytes !== buf ? 'png' : ext;
    const name = `${found.page.page_uid}.el-${nanoid(8)}.${finalExt}`;
    if (!ELEMENT_ASSET_NAME_RE.test(name)) {
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Could not name the asset'));
    }
    await fs.promises.mkdir(safeJoinPdfPath(id, 'pages'), { recursive: true });
    await fs.promises.writeFile(pageElementAssetPath(id, name), bytes);
    return reply.code(201).send({ id, page_number: n, asset: name, width, height, bytes: bytes.length });
  });

  app.get('/api/pdfs/:id/pages/:n/elements/assets/:name', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    const name = (request.params as { name?: string }).name ?? '';
    if (!parsed.success || !ELEMENT_ASSET_NAME_RE.test(name)) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id, page number or asset name'));
    }
    const { id, n } = parsed.data;
    const found = lookup(id, n);
    if (!found) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    if (!readGuard(request, id, found)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報'));
    const abs = resolvePageAssetPath(id, found.page.page_uid, name);
    if (!abs || !fs.existsSync(abs)) return reply.code(404).send(errorResponse('NOT_FOUND', 'Asset not found'));
    // Asset names are unique per upload, so a name never changes content: cache hard.
    return streamFile(reply, abs, assetMime(name), 'public, max-age=31536000, immutable');
  });

  app.get('/api/pdfs/:id/pages/:n/base-image', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const { id, n } = parsed.data;
    const found = lookup(id, n);
    if (!found) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    if (!readGuard(request, id, found)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的投影片圖片'));
    const base = pageBaseImagePath(id, found.page.page_uid);
    let file = base;
    if (!fs.existsSync(file)) {
      file = found.page.image_path ? safeJoinPdfPath(id, found.page.image_path) : pageImagePath(id, found.page.page_uid);
    }
    if (!fs.existsSync(file)) return reply.code(404).send(errorResponse('PAGE_IMAGE_NOT_FOUND', 'Page image file missing'));
    return streamFile(reply, file, 'image/jpeg', 'public, max-age=300');
  });
}
