import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { db } from '../../db';
import { config } from '../../config';
import type { PageRow, PdfRow } from '../../types';
import { getOpenAIClient } from '../../services/openai';
import { buildImagePrompt, IMAGE_PROMPT_TEMPLATES } from '../../services/imagePromptTemplates';
import { safeJoinPdfPath } from '../../services/storage';
import {
  AddPageBodySchema,
  IdParamSchema,
  MovePageBodySchema,
  PageParamSchema,
  RegenerateImageBodySchema,
  errorResponse,
  nowIso,
  rewritePagePathsToMatchNumber,
} from './shared';
import {
  pageImagePath,
  pageScriptPath,
  pageTextPath,
  readMetadata,
  renumberPageArtifacts,
  writeMetadata,
} from '../../services/storage';

export async function registerPageOperationsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/:id/pages', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = AddPageBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid body'));
    }
    const { id } = parsedParams.data;
    const row = db.prepare(`SELECT * FROM pdfs WHERE id = ?`).get(id) as PdfRow | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (row.status !== 'ready' || !row.page_count || row.page_count <= 0) {
      return reply.code(409).send(errorResponse('INVALID_STATE', 'Only ready deck can add slide'));
    }
    const oldCount = row.page_count;
    const after = parsedBody.data.after_page_number;
    if (after < 0 || after > oldCount) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid after_page_number'));
    }
    const inserted = after + 1;
    const now = nowIso();
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE pages
            SET page_number = page_number + 100000
          WHERE pdf_id = ? AND page_number > ?`,
      ).run(id, after);
      db.prepare(
        `UPDATE pages
            SET page_number = page_number - 99999
          WHERE pdf_id = ? AND page_number > ?`,
      ).run(id, after + 100000);
      db.prepare(
        `INSERT INTO pages (pdf_id, page_number, image_path, text_path, script_path, audio_path, audio_duration_seconds, status, error_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'audio_ready', NULL, ?, ?)`,
      ).run(
        id,
        inserted,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.jpg`,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.text.txt`,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.script.txt`,
        `pages/${String(inserted).padStart(oldCount > 999 ? 4 : 3, '0')}.mp3`,
        now,
        now,
      );
      db.prepare(`UPDATE pdfs SET page_count = ?, updated_at = ? WHERE id = ?`).run(oldCount + 1, now, id);
      rewritePagePathsToMatchNumber(id, oldCount + 1);
    });

    try {
      tx();
      await renumberPageArtifacts(
        id,
        oldCount,
        Array.from({ length: oldCount - after }, (_, i) => ({ from: oldCount - i, to: oldCount - i + 1 })),
      );
      await sharp({
        create: {
          width: 1920,
          height: 1080,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(pageImagePath(id, inserted, oldCount + 1));
      await fs.promises.writeFile(pageTextPath(id, inserted, oldCount + 1), '', 'utf8');
      await fs.promises.writeFile(pageScriptPath(id, inserted, oldCount + 1), '', 'utf8');
      const meta = await readMetadata(id);
      if (meta) {
        meta.page_count = oldCount + 1;
        meta.updated_at = now;
        meta.pages = db
          .prepare(`SELECT page_number, image_path, text_path, script_path, audio_path, status FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
          .all(id)
          .map((p: any) => ({
            page_number: p.page_number,
            image: p.image_path,
            text: p.text_path,
            script: p.script_path,
            audio: p.audio_path,
            status: p.status,
          }));
        await writeMetadata(id, meta);
      }
      return reply.code(201).send({ id, page_number: inserted, page_count: oldCount + 1, updated_at: now });
    } catch (err) {
      request.log.error({ err, pdfId: id }, 'Failed to add page');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to add page'));
    }
  });

  app.post('/api/pdfs/:id/pages/move', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = MovePageBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const { id } = parsedParams.data;
    const { from_page_number: from, to_page_number: to } = parsedBody.data;
    const pdfRow = db.prepare(`SELECT page_count FROM pdfs WHERE id = ?`).get(id) as { page_count: number | null } | undefined;
    if (!pdfRow?.page_count) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const pageCount = pdfRow.page_count;
    if (from < 1 || from > pageCount || to < 1 || to > pageCount) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid from_page_number or to_page_number'));
    }
    if (from === to) {
      return reply.code(200).send({ id, page_count: pageCount, updated_at: nowIso() });
    }

    const rows = db
      .prepare(`SELECT page_number FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
      .all(id) as Array<{ page_number: number }>;
    const order = rows.map((r) => r.page_number);
    if (order.length !== pageCount) {
      return reply.code(409).send(errorResponse('INVALID_STATE', 'Page list incomplete'));
    }

    const fromIdx = from - 1;
    const toIdx = to - 1;
    const [moved] = order.splice(fromIdx, 1);
    if (moved == null) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid from_page_number'));
    }
    order.splice(toIdx, 0, moved);

    const now = nowIso();
    const updates: Array<{ from: number; to: number }> = [];
    const tx = db.transaction(() => {
      db.prepare(`UPDATE pages SET page_number = page_number + 100000 WHERE pdf_id = ?`).run(id);
      for (let i = 0; i < order.length; i++) {
        const src = order[i];
        if (src == null) continue;
        const dst = i + 1;
        updates.push({ from: src, to: dst });
        db.prepare(`UPDATE pages SET page_number = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(
          dst,
          now,
          id,
          src + 100000,
        );
      }
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);
      rewritePagePathsToMatchNumber(id, pageCount);
    });

    try {
      tx();
      await renumberPageArtifacts(id, pageCount, updates);
      const meta = await readMetadata(id);
      if (meta) {
        const metaRows = db
          .prepare(`SELECT page_number, image_path, text_path, script_path, audio_path, status FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
          .all(id) as Array<{ page_number: number; image_path: string | null; text_path: string | null; script_path: string | null; audio_path: string | null; status: string }>;
        meta.pages = metaRows.map((p) => ({
          page_number: p.page_number,
          image: p.image_path,
          text: p.text_path,
          script: p.script_path,
          audio: p.audio_path,
          status: p.status as PageRow['status'],
        }));
        meta.updated_at = now;
        await writeMetadata(id, meta);
      }
    } catch (err) {
      request.log.error({ err, pdfId: id, from, to }, 'Failed to move page');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to move page'));
    }

    return reply.code(200).send({ id, page_count: pageCount, updated_at: now });
  });

  app.post('/api/pdfs/:id/pages/:n/replace-image', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    if (!request.isMultipart()) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    }
    const { id, n } = parsed.data;
    const pageRow = db
      .prepare(`SELECT pdf_id, page_number FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { pdf_id: string; page_number: number } | undefined;
    if (!pageRow) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    const row = db.prepare(`SELECT page_count FROM pdfs WHERE id = ?`).get(id) as { page_count: number | null } | undefined;
    if (!row?.page_count) return reply.code(409).send(errorResponse('INVALID_STATE', 'PDF page_count not ready'));

    const file = await request.file();
    if (!file) return reply.code(400).send(errorResponse('NO_FILE', 'No file field found'));
    const imageBuffer = await file.toBuffer();
    try {
      const meta = await sharp(imageBuffer).metadata();
      if (!meta.format) {
        return reply.code(400).send(errorResponse('INVALID_MIME', 'Image must be decodable'));
      }
    } catch {
      return reply.code(400).send(errorResponse('INVALID_MIME', 'Image must be decodable'));
    }

    const outPath = pageImagePath(id, n, row.page_count);
    await sharp(imageBuffer)
      .resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(outPath);

    const relImagePath = path.posix.join('pages', `${String(n).padStart(row.page_count > 999 ? 4 : 3, '0')}.jpg`);
    const now = nowIso();
    db.prepare(`UPDATE pages SET image_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(relImagePath, now, id, n);
    db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, id);

    try {
      const meta = await readMetadata(id);
      if (meta) {
        const page = meta.pages.find((p) => p.page_number === n);
        if (page) page.image = relImagePath;
        meta.updated_at = now;
        await writeMetadata(id, meta);
      }
    } catch {
      // non-fatal
    }

    return reply.code(200).send({ id, page_number: n, image_url: `api/pdfs/${id}/pages/${n}/image`, updated_at: now });
  });

  app.post('/api/pdfs/:id/pages/:n/regenerate-image', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = RegenerateImageBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const prompt = parsedBody.data.prompt.trim();

    const pdfRow = db.prepare(`SELECT page_count FROM pdfs WHERE id = ?`).get(id) as { page_count: number | null } | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!pdfRow.page_count || n > pdfRow.page_count) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }
    const pageRow = db
      .prepare(`SELECT image_path, text_path, script_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, n) as { image_path: string | null; text_path: string | null; script_path: string | null } | undefined;
    if (!pageRow) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));
    }

    try {
      const client = getOpenAIClient();
      let pageText = '';
      let pageScript = '';
      if (pageRow.text_path) {
        try {
          pageText = await fs.promises.readFile(safeJoinPdfPath(id, pageRow.text_path), 'utf8');
        } catch {
          pageText = '';
        }
      }
      if (pageRow.script_path) {
        try {
          pageScript = await fs.promises.readFile(safeJoinPdfPath(id, pageRow.script_path), 'utf8');
        } catch {
          pageScript = '';
        }
      }

      const mergedPrompt = buildImagePrompt({
        stylePrompt: IMAGE_PROMPT_TEMPLATES[0]?.prompt_en,
        pageText,
        pageScript,
        userAdjustmentPrompt: prompt,
      });

      const edited = await client.images.generate({
        model: config.openaiImageModel,
        prompt: mergedPrompt,
        size: '1536x1024',
      });
      const b64 = edited.data?.[0]?.b64_json;
      if (!b64) throw new Error('OpenAI image edit returned empty result');
      const newBuf = Buffer.from(b64, 'base64');
      const outPath = pageImagePath(id, n, pdfRow.page_count);
      await sharp(newBuf).resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(outPath);

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
      return reply.code(200).send({ id, page_number: n, image_url: `api/pdfs/${id}/pages/${n}/image`, updated_at: now });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to regenerate image by prompt');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to regenerate image'));
    }
  });
}
