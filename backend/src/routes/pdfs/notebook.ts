import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { sessionSub } from '../auth';
import { getPdfPermissionRow, canReadPdf, canEditPdf, aclCtx } from './permissions';
import { pageAnimationSpecPath, pageNotebookPath, safeJoinPdfPath, readMetadata, writeMetadata } from '../../services/storage';
import { defaultNotebook, parseStoredNotebook, validateNotebook, type NotebookDocument } from '../../services/notebookAsset';
import { parseStoredAnimationSpec, renderTypeForSpec } from '../../services/pageAnimation';
import { generateNotebookFromTopic } from '../../services/notebookGeneration';
import { sumPageAudioDurations } from '../../worker/audioDurationSum';
import type { SlideRenderType } from '../../types';
import { PageParamSchema, errorResponse, nowIso, replyIfLlmDisabled } from './shared';

const SaveNotebookBodySchema = z.object({
  notebook: z.unknown(),
});

const GenerateNotebookBodySchema = z.object({
  topic: z.string().trim().min(1).max(500),
  context: z.string().max(4000).optional(),
});

interface NotebookPageRow {
  page_uid: string;
  render_type: SlideRenderType | null;
  notebook_path: string | null;
  animation_spec_path: string | null;
}

function getNotebookPageRow(id: string, n: number): NotebookPageRow | undefined {
  return db
    .prepare(
      `SELECT page_uid, render_type, notebook_path, animation_spec_path FROM pages WHERE pdf_id = ? AND page_number = ?`,
    )
    .get(id, n) as NotebookPageRow | undefined;
}

/**
 * Read the page's stored `.ipynb`. Prefer the explicit `notebook_path` column over the
 * conventional `<page_uid>.ipynb` location: they match for natively created pages but can
 * diverge after a ZIP import (import.ts regenerates page_uid while asset files keep their
 * original names), mirroring how page-animation.ts resolves the stored spec path.
 */
function readStoredNotebook(id: string, row: NotebookPageRow): ReturnType<typeof parseStoredNotebook> {
  const absPath = row.notebook_path
    ? safeJoinPdfPath(id, row.notebook_path)
    : pageNotebookPath(id, row.page_uid);
  if (!fs.existsSync(absPath)) {
    return defaultNotebook();
  }
  try {
    return parseStoredNotebook(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return defaultNotebook();
  }
}

/**
 * Persist a validated notebook to a page: write the `.ipynb`, flip the page's render_type to
 * 'notebook', record notebook_path, and best-effort resync metadata.json (the DB is the source
 * of truth). Shared by the PUT-notebook route (edits / execution write-back) and the AI-generate
 * route (phase 4b) so both keep the DB/metadata in lockstep the same way.
 */
export async function writeNotebookForPage(
  id: string,
  n: number,
  pageUid: string,
  notebook: NotebookDocument,
): Promise<{ relNotebookPath: string; now: string }> {
  const relNotebookPath = `pages/${pageUid}.ipynb`;
  await fs.promises.writeFile(pageNotebookPath(id, pageUid), `${JSON.stringify(notebook, null, 1)}\n`, 'utf8');
  const now = nowIso();
  db.prepare(
    `UPDATE pages SET render_type = 'notebook', notebook_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
  ).run(relNotebookPath, now, id, n);
  // The page is now a notebook, so recompute the deck total with it excluded (phase 5b): notebook
  // pages never play audio (phase 1d), so any audio_duration lingering from before it was
  // converted must not inflate the total.
  const durationRows = db
    .prepare(`SELECT audio_duration_seconds, render_type FROM pages WHERE pdf_id = ?`)
    .all(id) as Array<{ audio_duration_seconds: number | null; render_type: string | null }>;
  const totalAudioDurationSeconds = sumPageAudioDurations(durationRows);
  db.prepare(`UPDATE pdfs SET total_audio_duration_seconds = ?, updated_at = ? WHERE id = ?`).run(
    totalAudioDurationSeconds,
    now,
    id,
  );

  // Keep metadata.json consistent with the DB (mirrors the consistency lesson: metadata is a
  // derived snapshot of the DB, so a resync failure is logged-by-omission but never fatal).
  try {
    const meta = await readMetadata(id);
    if (meta) {
      const page = meta.pages.find((p) => p.page_number === n);
      if (page) {
        page.render_type = 'notebook';
        page.notebook_path = relNotebookPath;
      }
      meta.total_audio_duration_seconds = totalAudioDurationSeconds;
      meta.updated_at = now;
      await writeMetadata(id, meta);
    }
  } catch {
    // non-fatal
  }
  return { relNotebookPath, now };
}

/**
 * Turn a notebook page back into a slide — the inverse of `writeNotebookForPage()`.
 *
 * Until this existed `render_type` was one-way: `writeNotebookForPage()` hard-codes 'notebook'
 * and nothing anywhere set it back, so converting a page to a notebook was permanent. The
 * `.ipynb` is deliberately left on disk and `notebook_path` is cleared but the file kept, so
 * converting back and forth does not destroy the notebook's contents.
 *
 * The restored render type comes from the page's animation spec rather than being hard-coded to
 * 'static-image': a page that had an animation before it became a notebook should get its
 * 'gsap-image' type back, otherwise the spec file would linger while the page silently renders
 * without it.
 */
async function revertNotebookPageToSlide(
  id: string,
  n: number,
  row: NotebookPageRow,
): Promise<{ renderType: SlideRenderType; now: string }> {
  const specPath = row.animation_spec_path
    ? safeJoinPdfPath(id, row.animation_spec_path)
    : pageAnimationSpecPath(id, row.page_uid);
  let renderType: SlideRenderType = 'static-image';
  if (fs.existsSync(specPath)) {
    try {
      renderType = renderTypeForSpec(parseStoredAnimationSpec(await fs.promises.readFile(specPath, 'utf8')));
    } catch {
      renderType = 'static-image';
    }
  }

  const now = nowIso();
  db.prepare(
    `UPDATE pages SET render_type = ?, notebook_path = NULL, updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
  ).run(renderType, now, id, n);

  // The page can play audio again, so the deck total has to be recomputed with it included —
  // the mirror of the exclusion writeNotebookForPage() performs.
  const durationRows = db
    .prepare(`SELECT audio_duration_seconds, render_type FROM pages WHERE pdf_id = ?`)
    .all(id) as Array<{ audio_duration_seconds: number | null; render_type: string | null }>;
  const totalAudioDurationSeconds = sumPageAudioDurations(durationRows);
  db.prepare(`UPDATE pdfs SET total_audio_duration_seconds = ?, updated_at = ? WHERE id = ?`).run(
    totalAudioDurationSeconds,
    now,
    id,
  );

  try {
    const meta = await readMetadata(id);
    if (meta) {
      const page = meta.pages.find((p) => p.page_number === n);
      if (page) {
        page.render_type = renderType;
        page.notebook_path = null;
      }
      meta.total_audio_duration_seconds = totalAudioDurationSeconds;
      meta.updated_at = now;
      await writeMetadata(id, meta);
    }
  } catch {
    // non-fatal, same as writeNotebookForPage
  }
  return { renderType, now };
}

export async function registerNotebookRoutes(app: FastifyInstance): Promise<void> {
  // GET the page's `.ipynb` as nbformat JSON. Returns a default empty notebook when none
  // is stored yet, so the frontend always has a valid document to open.
  app.get('/api/pdfs/:id/pages/:n/notebook', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const row = getNotebookPageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的 notebook'));
    }
    const notebook = readStoredNotebook(id, row);
    // no-store so the renderer never opens a stale notebook right after a save/execute writes back
    return reply.header('Cache-Control', 'no-store').code(200).send({
      page_number: n,
      render_type: row.render_type === 'notebook' ? 'notebook' : (row.render_type ?? 'static-image'),
      notebook,
    });
  });

  // PUT (create/replace) the page's `.ipynb`. Used both for editing cells and for writing
  // execution outputs back. Flips render_type to 'notebook', records notebook_path, and keeps
  // metadata.json in lockstep with the DB (best-effort, DB is source of truth).
  app.put('/api/pdfs/:id/pages/:n/notebook', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = SaveNotebookBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const row = getNotebookPageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的 notebook'));
    }
    const validated = validateNotebook(parsedBody.data.notebook);
    if (!validated.ok) {
      return reply.code(400).send(errorResponse('INVALID_NOTEBOOK', validated.message));
    }
    const { now } = await writeNotebookForPage(id, n, row.page_uid, validated.notebook);

    return reply.code(200).send({
      page_number: n,
      render_type: 'notebook',
      notebook_url: `api/pdfs/${id}/pages/${n}/notebook`,
      updated_at: now,
    });
  });

  // POST: AI-generate an executable notebook for the page from a topic (phase 4b). The model
  // returns a validated outline that is turned into nbformat and persisted like any other write
  // (flips render_type to 'notebook'). Requires edit permission.
  app.post('/api/pdfs/:id/pages/:n/notebook/generate', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = GenerateNotebookBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'A non-empty topic is required'));
    }
    const { id, n } = parsed.data;
    const row = getNotebookPageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的 notebook'));
    }
    if (replyIfLlmDisabled(reply)) return reply;
    let notebook: NotebookDocument;
    try {
      notebook = await generateNotebookFromTopic(parsedBody.data.topic, parsedBody.data.context);
    } catch (err) {
      request.log.warn({ err, id, n }, 'notebook generation failed');
      return reply.code(502).send(errorResponse('NOTEBOOK_GENERATION_FAILED', 'AI 產生 notebook 失敗，請稍後再試'));
    }
    const { now } = await writeNotebookForPage(id, n, row.page_uid, notebook);

    return reply.code(200).send({
      page_number: n,
      render_type: 'notebook',
      notebook_url: `api/pdfs/${id}/pages/${n}/notebook`,
      notebook,
      updated_at: now,
    });
  });

  // POST: convert a notebook page back into a slide. Without this, render_type was one-way and
  // a page converted to a notebook could never become a slide again. The stored `.ipynb` is
  // kept so the conversion is reversible in both directions.
  app.post('/api/pdfs/:id/pages/:n/convert-to-slide', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const row = getNotebookPageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的頁面'));
    }
    if (row.render_type !== 'notebook') {
      return reply.code(409).send(errorResponse('INVALID_STATE', '這一頁不是 notebook 頁'));
    }
    const { renderType, now } = await revertNotebookPageToSlide(id, n, row);
    return reply.code(200).send({
      page_number: n,
      render_type: renderType,
      updated_at: now,
    });
  });
}
