import fs from 'node:fs';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { sessionSub } from '../auth';
import { getPdfPermissionRow, canReadPdf, canEditPdf, aclCtx } from './permissions';
import {
  pageAnimationSpecPath,
  pageReactSlideBackgroundPath,
  pageReactSlideCompiledPath,
  pageReactSlideConfigPath,
  pageReactSlideSourcePath,
  readMetadata,
  safeJoinPdfPath,
  slideThemePath,
  writeMetadata,
} from '../../services/storage';
import { parseStoredAnimationSpec, renderTypeForSpec } from '../../services/pageAnimation';
import {
  MAX_OVERRIDE_TEXT_LENGTH,
  MAX_REACT_SLIDE_CODE_LENGTH,
  MAX_REACT_SLIDE_PROMPT_LENGTH,
  buildBackgroundImagePrompt,
  defaultReactSlideCode,
  defaultReactSlideConfig,
  defaultSlideTheme,
  generateReactSlideCode,
  generateSlideTheme,
  parseStoredReactSlideConfig,
  parseStoredSlideTheme,
  sanitizeReactSlideConfig,
  sanitizeSlideTheme,
  validateAndCompileReactSlide,
  type ReactSlideConfig,
  type SlideTheme,
} from '../../services/reactSlide';
import { applySlideEdits } from '../../services/reactSlideEdit';
import { textLayerStyleProperties } from '../../services/reactSlideTextExtract';
import { commitPresentationFile } from '../../services/presentationGit';
import { withImageProviderFailover, imageEditTimeoutMs, describeImageEditFailure } from './page-operations';
import { toFile } from 'openai/uploads';
import { adoptPageImageAsBackground, buildDeckOutline, writeReactSlideForPage } from '../../services/reactSlidePage';
import { BakeUnavailableError, bakeReactSlidePage, isBakePending, scheduleReactSlideBake } from '../../services/reactSlideBake';
import {
  ERASE_TEXT_PROMPT,
  SlideRegionSchema,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  buildRegionMask,
  compositeErasedRegion,
  computeEraseContext,
  extractTextFromRegion,
  regionToPixels,
  isUsableImage,
  type SlideRegion,
} from '../../services/reactSlideTextExtract';
import { currentAccountId } from '../../services/accountContext';
import type { SlideRenderType } from '../../types';
import { IdParamSchema, PageParamSchema, errorResponse, nowIso, replyIfLlmDisabled } from './shared';

/**
 * React slide pages (`render_type = 'react'`) — see docs/react-slide-design.md.
 *
 * Three groups of endpoints: the page's code + config, the page's generated background image, and
 * the deck-wide theme. All of them treat the DB as the source of truth and resync metadata.json
 * best-effort, mirroring notebook.ts.
 */

const SaveReactSlideBodySchema = z.object({
  code: z.string().max(MAX_REACT_SLIDE_CODE_LENGTH).optional(),
  config: z.unknown().optional(),
});

/**
 * Element edits, applied to the page's JSX.
 *
 * The panel accumulates edits while the user works (so dragging a slider still restyles the live
 * DOM without a recompile) and sends them here on save. Batched rather than one request per
 * keystroke: every edit is resolved against the same parse of the file, which is what keeps two
 * simultaneous edits from invalidating each other's offsets.
 */
const SlideEditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), id: z.string().max(32), text: z.string().max(MAX_OVERRIDE_TEXT_LENGTH) }),
  z.object({ kind: z.literal('style'), id: z.string().max(32), property: z.string().max(64), value: z.string().max(200) }),
  z.object({ kind: z.literal('delete'), id: z.string().max(32) }),
]);

const ApplyEditsBodySchema = z.object({
  edits: z.array(SlideEditSchema).min(1).max(200),
});

const GenerateReactSlideBodySchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_REACT_SLIDE_PROMPT_LENGTH),
  /** Keep the user's per-element text/CSS tweaks; off by default because a new layout usually invalidates them. */
  keepOverrides: z.boolean().optional(),
});

const GenerateBackgroundBodySchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_REACT_SLIDE_PROMPT_LENGTH),
  overlayOpacity: z.number().min(0).max(1).optional(),
});

/** Where the previous background is kept, so replacing or erasing one is undoable. */
const BACKGROUND_UNDO_SUFFIX = '.slide-bg.prev.png';

const ExtractTextBodySchema = z.object({
  region: SlideRegionSchema,
  /** Whether to also erase the text from the background image (an extra, slower image call). */
  eraseBackground: z.boolean().optional(),
});

const GenerateThemeBodySchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_REACT_SLIDE_PROMPT_LENGTH),
});

interface ReactSlidePageRow {
  page_uid: string;
  render_type: SlideRenderType | null;
  react_slide_path: string | null;
  animation_spec_path: string | null;
  text_path: string | null;
  script_path: string | null;
}

function getReactSlidePageRow(id: string, n: number): ReactSlidePageRow | undefined {
  return db
    .prepare(
      `SELECT page_uid, render_type, react_slide_path, animation_spec_path, text_path, script_path
       FROM pages WHERE pdf_id = ? AND page_number = ?`,
    )
    .get(id, n) as ReactSlidePageRow | undefined;
}

/**
 * Prefer the recorded `react_slide_path` over the conventional `<page_uid>.slide.jsx` location:
 * they match for natively created pages but diverge after a ZIP import (import.ts regenerates
 * page_uid while asset files keep their original names) — the same reason notebook.ts and
 * page-animation.ts resolve their assets this way.
 */
function readStoredCode(id: string, row: ReactSlidePageRow): string | null {
  const absPath = row.react_slide_path
    ? safeJoinPdfPath(id, row.react_slide_path)
    : pageReactSlideSourcePath(id, row.page_uid);
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function readStoredConfig(id: string, pageUid: string): ReactSlideConfig {
  try {
    return parseStoredReactSlideConfig(fs.readFileSync(pageReactSlideConfigPath(id, pageUid), 'utf8'));
  } catch {
    return defaultReactSlideConfig();
  }
}

export function readStoredTheme(id: string): SlideTheme {
  try {
    return parseStoredSlideTheme(fs.readFileSync(slideThemePath(id), 'utf8'));
  } catch {
    return defaultSlideTheme();
  }
}

async function writeStoredConfig(id: string, pageUid: string, config: ReactSlideConfig): Promise<void> {
  await fs.promises.writeFile(
    pageReactSlideConfigPath(id, pageUid),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Turn a React page back into an ordinary slide — the inverse of `writeReactSlideForPage()`.
 * The `.slide.jsx`/`.slide.json` files stay on disk so the conversion is reversible; the restored
 * render type comes from the page's animation spec so a page that had an animation before it
 * became a React slide gets its `gsap-image` type back rather than being flattened.
 */
async function revertReactPageToSlide(
  id: string,
  n: number,
  row: ReactSlidePageRow,
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
    `UPDATE pages SET render_type = ?, react_slide_path = NULL, updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
  ).run(renderType, now, id, n);
  try {
    const meta = await readMetadata(id);
    if (meta) {
      const page = meta.pages.find((p) => p.page_number === n);
      if (page) {
        page.render_type = renderType;
        page.react_slide_path = null;
      }
      meta.updated_at = now;
      await writeMetadata(id, meta);
    }
  } catch {
    // non-fatal
  }
  return { renderType, now };
}

/** Backup of the background a replace/erase is about to overwrite (see BACKGROUND_UNDO_SUFFIX). */
function backgroundUndoPath(id: string, pageUid: string): string {
  return safeJoinPdfPath(id, 'pages', `${pageUid}${BACKGROUND_UNDO_SUFFIX}`);
}

/**
 * Repaint the region of the page's background so the text that used to be there is gone.
 *
 * The previous background is kept first: this is destructive and generative, so "undo" has to be
 * one button rather than "generate a whole new background and hope".
 */
const ERASE_MODEL_WIDTH = 1536;
const ERASE_MODEL_HEIGHT = 1024;

async function eraseRegionFromBackground(id: string, pageUid: string, region: SlideRegion): Promise<void> {
  const target = pageReactSlideBackgroundPath(id, pageUid);
  // Normalised to the canvas first, so the box maths matches whatever the stored image happens to
  // be — the same normalisation cropRegionDataUrl does for recognition.
  const original = await sharp(target)
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
  const box = regionToPixels(region);
  const context = computeEraseContext(box, CANVAS_WIDTH, CANVAS_HEIGHT, ERASE_MODEL_WIDTH / ERASE_MODEL_HEIGHT);

  // Only the crop goes to the model, and it already has the model's aspect ratio: no letterboxing,
  // so the mask's hole lands exactly on the box the user drew.
  const source = await sharp(original)
    .extract(context)
    .resize(ERASE_MODEL_WIDTH, ERASE_MODEL_HEIGHT, { fit: 'fill' })
    .png()
    .toBuffer();
  const mask = await buildRegionMask(
    {
      xPct: ((box.left - context.left) / context.width) * 100,
      yPct: ((box.top - context.top) / context.height) * 100,
      widthPct: (box.width / context.width) * 100,
      heightPct: (box.height / context.height) * 100,
    },
    ERASE_MODEL_WIDTH,
    ERASE_MODEL_HEIGHT,
  );

  const imageFile = await toFile(source, 'background.png', { type: 'image/png' });
  const maskFile = await toFile(mask, 'mask.png', { type: 'image/png' });
  const edited = await withImageProviderFailover(currentAccountId(), ({ client, model }) =>
    client.images.edit(
      {
        model,
        image: imageFile,
        mask: maskFile,
        prompt: ERASE_TEXT_PROMPT,
        size: `${ERASE_MODEL_WIDTH}x${ERASE_MODEL_HEIGHT}`,
      },
      { timeout: imageEditTimeoutMs() },
    ));
  const b64 = edited.data?.[0]?.b64_json;
  if (!b64) throw new Error('Image edit returned an empty result while erasing text');

  await fs.promises.copyFile(target, backgroundUndoPath(id, pageUid));
  // Only the box is written back. The model repaints its whole input — that is what wiped text
  // outside the selection off the page — so the guarantee has to be structural, not a request.
  const composited = await compositeErasedRegion({
    original,
    edited: Buffer.from(b64, 'base64'),
    context,
    box,
  });
  await fs.promises.writeFile(target, composited);
}

/** Deck title, used only as extra context for theme generation ("a theme for <title>"). */
function deckTitle(id: string): string | undefined {
  const row = db.prepare(`SELECT title FROM pdfs WHERE id = ?`).get(id) as { title: string | null } | undefined;
  return row?.title ?? undefined;
}

function readPageFile(id: string, relPath: string | null): string {
  if (!relPath) return '';
  try {
    return fs.readFileSync(safeJoinPdfPath(id, relPath), 'utf8');
  } catch {
    return '';
  }
}

export async function registerReactSlideRoutes(app: FastifyInstance): Promise<void> {
  // GET the page's React slide source, compiled output and config. A page that isn't a React
  // slide yet gets the default skeleton, so the editor always has something to show and "make
  // this page a React slide" is just a save away.
  app.get('/api/pdfs/:id/pages/:n/react-slide', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const row = getReactSlidePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的頁面'));
    }
    const storedCode = readStoredCode(id, row);
    const code = storedCode ?? defaultReactSlideCode();
    let compiled = '';
    try {
      compiled = fs.readFileSync(pageReactSlideCompiledPath(id, row.page_uid), 'utf8');
    } catch {
      compiled = '';
    }
    // The compiled file can be missing (page never saved, or an older deck imported from ZIP).
    // Compiling on read keeps the viewer working instead of showing an empty slide; it is cheap
    // (esbuild, no network) and the result is not persisted here because GET must stay read-only.
    if (!compiled) {
      const validation = await validateAndCompileReactSlide(code);
      compiled = validation.ok ? (validation.compiled ?? '') : '';
    }
    return reply.header('Cache-Control', 'no-store').code(200).send({
      page_number: n,
      render_type: row.render_type ?? 'static-image',
      code,
      compiled,
      config: readStoredConfig(id, row.page_uid),
      theme: readStoredTheme(id),
      has_code: storedCode !== null,
    });
  });

  // PUT: save code and/or config. Saving code compiles it first — a page is never stored in a
  // state that only fails once a viewer opens it.
  app.put('/api/pdfs/:id/pages/:n/react-slide', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = SaveReactSlideBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const row = getReactSlidePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的頁面'));
    }

    let now = nowIso();
    let stored: { code: string; compiled: string } | null = null;
    const becomingReactPage = row.render_type !== 'react';
    if (parsedBody.data.code !== undefined) {
      const validation = await validateAndCompileReactSlide(parsedBody.data.code);
      if (!validation.ok || !validation.compiled) {
        return reply
          .code(422)
          .send(errorResponse('REACT_SLIDE_INVALID', validation.message ?? 'Slide code is invalid'));
      }
      stored = await writeReactSlideForPage(id, n, row.page_uid, parsedBody.data.code, validation.compiled, now);
    }
    let config = readStoredConfig(id, row.page_uid);

    // A page that has just become a React slide adopts its old image as the background, so the
    // conversion adds a layer instead of appearing to wipe the slide. Only when it has no
    // background of its own — never overwrite a choice the user already made.
    if (becomingReactPage && parsedBody.data.code !== undefined && config.background.mode === 'none') {
      const adopted = await adoptPageImageAsBackground(id, row.page_uid, readStoredTheme(id));
      if (adopted) {
        config = { ...config, background: adopted, updated_at: now };
        await writeStoredConfig(id, row.page_uid, config);
      }
    }
    if (parsedBody.data.code !== undefined) scheduleReactSlideBake(id, n);
    if (parsedBody.data.config !== undefined) {
      config = { ...sanitizeReactSlideConfig(parsedBody.data.config), updated_at: now };
      await writeStoredConfig(id, row.page_uid, config);
      if (row.render_type === 'react' || parsedBody.data.code !== undefined) scheduleReactSlideBake(id, n);
    }
    return reply.code(200).send({
      page_number: n,
      render_type: parsedBody.data.code !== undefined ? 'react' : (row.render_type ?? 'static-image'),
      ...(stored ? { code: stored.code, compiled: stored.compiled } : {}),
      config,
      updated_at: now,
    });
  });

  /**
   * PATCH: apply element edits to the page's JSX.
   *
   * This is where an edit becomes permanent, and the code is the only place it lands — there is no
   * parallel overlay to keep in step, and "what does this slide say" has one answer. Edits that no
   * longer match anything (the element was regenerated away, or the code was hand-edited) come
   * back in `skipped` instead of being dropped, because a change that silently fails to save while
   * the panel still shows it is worse than one that fails loudly.
   */
  app.patch('/api/pdfs/:id/pages/:n/react-slide/edits', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = ApplyEditsBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const row = getReactSlidePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的頁面'));
    }
    if (row.render_type !== 'react') {
      return reply.code(409).send(errorResponse('INVALID_STATE', '這一頁不是 React 投影片頁'));
    }
    const storedCode = readStoredCode(id, row);
    if (!storedCode) {
      return reply.code(409).send(errorResponse('NO_CODE', '這一頁還沒有 React 程式碼'));
    }

    let edited;
    try {
      edited = applySlideEdits(storedCode, parsedBody.data.edits);
    } catch (err) {
      request.log.warn({ err, id, n }, 'react slide: could not apply edits');
      return reply.code(422).send(errorResponse('EDIT_FAILED', '無法把這些修改寫回程式碼'));
    }
    const validation = await validateAndCompileReactSlide(edited.code);
    if (!validation.ok || !validation.compiled) {
      // The rewrite produced code that will not compile. Storing it would break the page, so the
      // edit is refused and the file is left exactly as it was.
      request.log.warn({ id, n, message: validation.message }, 'react slide: edits produced invalid code');
      return reply.code(422).send(errorResponse('REACT_SLIDE_INVALID', validation.message ?? 'Slide code is invalid'));
    }

    const now = nowIso();
    const stored = await writeReactSlideForPage(id, n, row.page_uid, edited.code, validation.compiled, now);
    // The code is the thing worth keeping history for now that it holds every edit.
    void commitPresentationFile(id, stored.relSourcePath, `react slide: edit page ${n}`);
    scheduleReactSlideBake(id, n);
    return reply.code(200).send({
      page_number: n,
      code: stored.code,
      compiled: stored.compiled,
      skipped: edited.skipped,
      updated_at: now,
    });
  });

  // DELETE: convert a React page back to an ordinary slide (files kept, see revertReactPageToSlide).
  app.delete('/api/pdfs/:id/pages/:n/react-slide', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const row = getReactSlidePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的頁面'));
    }
    if (row.render_type !== 'react') {
      return reply.code(409).send(errorResponse('INVALID_STATE', '這一頁不是 React 投影片頁'));
    }
    // Bake before reverting, not after: the page image is about to become the only thing anyone
    // sees, so it should be the React slide the user was just looking at rather than whatever
    // picture predates it. Baking needs the page to still be a React slide, hence the order.
    // A failure here is not fatal — the conversion is what was asked for; the image just stays old.
    try {
      await bakeReactSlidePage(id, n);
    } catch (err) {
      request.log.warn({ err, id, n }, 'could not bake before converting the React page back to a slide');
    }
    const { renderType, now } = await revertReactPageToSlide(id, n, row);
    return reply.code(200).send({ page_number: n, render_type: renderType, updated_at: now });
  });

  // POST: AI-generate the page's React code from a one-line description.
  app.post('/api/pdfs/:id/pages/:n/react-slide/generate', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = GenerateReactSlideBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'A non-empty prompt is required'));
    }
    const { id, n } = parsed.data;
    const row = getReactSlidePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的頁面'));
    }
    if (replyIfLlmDisabled(reply)) return reply;

    const theme = readStoredTheme(id);
    let generated: { code: string; compiled: string };
    try {
      generated = await generateReactSlideCode({
        prompt: parsedBody.data.prompt,
        pageText: readPageFile(id, row.text_path),
        pageScript: readPageFile(id, row.script_path),
        currentCode: readStoredCode(id, row) ?? undefined,
        deckOutline: buildDeckOutline(id, n),
        theme,
      });
    } catch (err) {
      request.log.warn({ err, id, n }, 'react slide generation failed');
      return reply
        .code(502)
        .send(errorResponse('REACT_SLIDE_GENERATION_FAILED', 'AI 產生 React 投影片失敗，請稍後再試'));
    }
    const now = nowIso();
    await writeReactSlideForPage(id, n, row.page_uid, generated.code, generated.compiled, now);

    // A new layout invalidates element paths, so overrides are cleared unless the user asked to
    // keep them (§5.1: paths follow structure, and stale ones would silently apply to the wrong
    // element). The background is part of the config and is preserved either way.
    const previous = readStoredConfig(id, row.page_uid);
    const config: ReactSlideConfig = {
      ...previous,
      prompt: parsedBody.data.prompt,
      overrides: parsedBody.data.keepOverrides ? previous.overrides : {},
      updated_at: now,
    };
    await writeStoredConfig(id, row.page_uid, config);
    scheduleReactSlideBake(id, n);

    return reply.code(200).send({
      page_number: n,
      render_type: 'react',
      code: generated.code,
      compiled: generated.compiled,
      config,
      updated_at: now,
    });
  });

  // POST: generate a background image for the page, using the same image provider (and failover)
  // as every other image in the product.
  app.post('/api/pdfs/:id/pages/:n/react-slide/background', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = GenerateBackgroundBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'A non-empty prompt is required'));
    }
    const { id, n } = parsed.data;
    const row = getReactSlidePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的頁面'));
    }
    const accountId = currentAccountId();
    const theme = readStoredTheme(id);
    const prompt = buildBackgroundImagePrompt(parsedBody.data.prompt, theme);

    let buffer: Buffer;
    try {
      const generatedImage = await withImageProviderFailover(accountId, ({ client, model }) =>
        client.images.generate(
          { model, prompt, size: '1536x1024' } as never,
          { timeout: imageEditTimeoutMs() },
        ));
      const b64 = generatedImage.data?.[0]?.b64_json;
      if (!b64) throw new Error('Image provider returned an empty result');
      buffer = Buffer.from(b64, 'base64');
    } catch (err) {
      request.log.warn({ err, id, n }, 'react slide background generation failed');
      const reason = describeImageEditFailure(err) ?? '產生背景圖失敗，請稍後再試';
      return reply.code(502).send(errorResponse('BACKGROUND_GENERATION_FAILED', reason));
    }

    await fs.promises.writeFile(pageReactSlideBackgroundPath(id, row.page_uid), buffer);
    const now = nowIso();
    const previous = readStoredConfig(id, row.page_uid);
    const config: ReactSlideConfig = {
      ...previous,
      background: {
        mode: 'image',
        prompt: parsedBody.data.prompt,
        file: `pages/${row.page_uid}.slide-bg.png`,
        fit: previous.background.fit ?? 'cover',
        overlayColor: previous.background.overlayColor ?? theme.tokens['--slide-bg'],
        overlayOpacity: parsedBody.data.overlayOpacity ?? previous.background.overlayOpacity ?? 0.45,
      },
      updated_at: now,
    };
    await writeStoredConfig(id, row.page_uid, config);
    scheduleReactSlideBake(id, n);
    return reply.code(200).send({ page_number: n, config, updated_at: now });
  });

  // POST: set the page's background from an uploaded image (multipart `file`).
  //
  // This is where an edited image lands on a React page. Writing it to the page JPG — which is
  // what the ordinary "replace image" flow does — would be silently undone: that JPG is a bake
  // artifact (§9.1) and the next save overwrites it. The background is the React page's actual
  // visual floor, so that is what an edit has to replace.
  app.post('/api/pdfs/:id/pages/:n/react-slide/background-image', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    if (!request.isMultipart()) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    }
    const { id, n } = parsed.data;
    const row = getReactSlidePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的頁面'));
    }
    const file = await request.file();
    if (!file) return reply.code(400).send(errorResponse('NO_FILE', 'No file field found'));
    const uploaded = await file.toBuffer();

    const target = pageReactSlideBackgroundPath(id, row.page_uid);
    try {
      // Keep the previous background: replacing it is destructive and generated edits are not
      // always an improvement, so "undo" has to be one button rather than "regenerate it again".
      if (fs.existsSync(target)) {
        await fs.promises.copyFile(target, backgroundUndoPath(id, row.page_uid));
      }
      await sharp(uploaded)
        .resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
        .png()
        .toFile(target);
    } catch {
      return reply.code(400).send(errorResponse('INVALID_MIME', 'Image must be decodable'));
    }

    const now = nowIso();
    const previous = readStoredConfig(id, row.page_uid);
    const config: ReactSlideConfig = {
      ...previous,
      background: {
        ...previous.background,
        mode: 'image',
        file: `pages/${row.page_uid}.slide-bg.png`,
        fit: previous.background.fit ?? 'cover',
      },
      updated_at: now,
    };
    await writeStoredConfig(id, row.page_uid, config);
    scheduleReactSlideBake(id, n);
    return reply.code(200).send({ page_number: n, config, updated_at: now });
  });

  // POST: put back the background this page had before the last replace/erase.
  app.post('/api/pdfs/:id/pages/:n/react-slide/background/undo', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const row = getReactSlidePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的頁面'));
    }
    const undoPath = backgroundUndoPath(id, row.page_uid);
    if (!fs.existsSync(undoPath)) {
      return reply.code(409).send(errorResponse('NOTHING_TO_UNDO', '沒有可以復原的上一張背景圖'));
    }
    // Swap rather than move, so undo is itself undoable — a user who undoes by mistake would
    // otherwise have destroyed the very image they were trying to keep.
    const target = pageReactSlideBackgroundPath(id, row.page_uid);
    const swap = `${target}.swap`;
    if (fs.existsSync(target)) await fs.promises.rename(target, swap);
    await fs.promises.rename(undoPath, target);
    if (fs.existsSync(swap)) await fs.promises.rename(swap, undoPath);

    const now = nowIso();
    const previous = readStoredConfig(id, row.page_uid);
    const config: ReactSlideConfig = { ...previous, updated_at: now };
    await writeStoredConfig(id, row.page_uid, config);
    scheduleReactSlideBake(id, n);
    return reply.code(200).send({ page_number: n, config, updated_at: now });
  });

  /**
   * POST: turn the text inside a region into a React text layer, and (optionally) erase those
   * pixels from the background so the words are not drawn twice.
   *
   * Recognition and erasure are reported separately because they fail separately: recognition is
   * quick and its result is useful on its own, while erasure is a generative image call that can
   * fail or produce something odd. A failed erase leaves the layer in place and says so, which
   * beats discarding a good recognition because the second step went wrong.
   */
  app.post('/api/pdfs/:id/pages/:n/react-slide/extract-text', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = ExtractTextBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'A region is required'));
    }
    const { id, n } = parsed.data;
    const row = getReactSlidePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的頁面'));
    }
    if (row.render_type !== 'react') {
      return reply.code(409).send(errorResponse('INVALID_STATE', '這一頁不是 React 投影片頁'));
    }
    if (replyIfLlmDisabled(reply)) return reply;

    const region: SlideRegion = parsedBody.data.region;
    const theme = readStoredTheme(id);
    const backgroundPath = pageReactSlideBackgroundPath(id, row.page_uid);
    // Read the text off the background when there is one; otherwise off the page image, which is
    // what a page that has not been given a background still shows.
    const source = (await isUsableImage(backgroundPath))
      ? backgroundPath
      : safeJoinPdfPath(id, `pages/${row.page_uid}.jpg`);
    if (!(await isUsableImage(source))) {
      return reply.code(409).send(errorResponse('NO_SOURCE_IMAGE', '這一頁沒有可以辨識文字的圖片'));
    }

    let extracted;
    try {
      extracted = await extractTextFromRegion(source, region, theme.tokens['--slide-fg']);
    } catch (err) {
      request.log.warn({ err, id, n }, 'text extraction failed');
      return reply.code(502).send(errorResponse('EXTRACT_TEXT_FAILED', 'AI 辨識文字失敗，請稍後再試'));
    }
    if (!extracted) {
      return reply.code(200).send({ page_number: n, layer: null, erase: 'skipped', config: readStoredConfig(id, row.page_uid) });
    }

    const now = nowIso();
    // The recognised text goes into the JSX, as an ordinary positioned element. It used to become
    // a config entry drawn in a separate layer, which meant the code did not know it existed —
    // the same split that made element edits and the code disagree.
    const storedCode = readStoredCode(id, row);
    if (!storedCode) {
      return reply.code(409).send(errorResponse('NO_CODE', '這一頁還沒有 React 程式碼'));
    }
    const inserted = applySlideEdits(storedCode, [
      { kind: 'insertText', text: extracted.layer.text, style: textLayerStyleProperties(extracted.layer) },
    ]);
    const validation = await validateAndCompileReactSlide(inserted.code);
    if (!validation.ok || !validation.compiled) {
      request.log.warn({ id, n, message: validation.message }, 'react slide: extracted text produced invalid code');
      return reply.code(422).send(errorResponse('REACT_SLIDE_INVALID', validation.message ?? 'Slide code is invalid'));
    }
    const written = await writeReactSlideForPage(id, n, row.page_uid, inserted.code, validation.compiled, now);
    void commitPresentationFile(id, written.relSourcePath, `react slide: extract text into page ${n}`);
    let config = readStoredConfig(id, row.page_uid);

    // Erasing is best-effort and only meaningful when there is a background to erase from.
    let erase: 'done' | 'skipped' | 'failed' = 'skipped';
    if (parsedBody.data.eraseBackground !== false && (await isUsableImage(backgroundPath))) {
      try {
        await eraseRegionFromBackground(id, row.page_uid, region);
        erase = 'done';
      } catch (err) {
        request.log.warn({ err, id, n }, 'could not erase the extracted text from the background');
        erase = 'failed';
      }
    }
    config = readStoredConfig(id, row.page_uid);
    if (erase === 'done') {
      // The background file changed underneath a URL that never changes, and the client keys its
      // cache-buster off `updated_at` — so without this the browser keeps showing the *old*
      // background, text and all, next to the text we just lifted out of it. It looks exactly
      // like the erase did nothing.
      config = { ...config, updated_at: nowIso() };
      await writeStoredConfig(id, row.page_uid, config);
    }
    scheduleReactSlideBake(id, n);
    return reply.code(200).send({
      page_number: n,
      layer: extracted.layer,
      code: written.code,
      compiled: written.compiled,
      erase,
      config,
      updated_at: config.updated_at ?? now,
    });
  });

  // GET the generated background image. Same read permission as the rest of the deck.
  app.get('/api/pdfs/:id/pages/:n/react-slide/background.png', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const row = getReactSlidePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的頁面'));
    }
    const filePath = pageReactSlideBackgroundPath(id, row.page_uid);
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send(errorResponse('NOT_FOUND', 'No background image for this page'));
    }
    return reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'no-cache')
      .code(200)
      .send(fs.createReadStream(filePath));
  });

  // POST: render the page in a headless browser and write the result to the page's JPG, so
  // thumbnails and every export (PDF/PPTX/video/SCORM/cover) show the React slide rather than
  // whatever picture the page had before it became one.
  app.post('/api/pdfs/:id/pages/:n/react-slide/bake', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const row = getReactSlidePageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的頁面'));
    }
    if (row.render_type !== 'react') {
      return reply.code(409).send(errorResponse('INVALID_STATE', '這一頁不是 React 投影片頁'));
    }
    try {
      const result = await bakeReactSlidePage(id, n);
      return reply.code(200).send({
        page_number: n,
        image_path: result.relImagePath,
        bytes: result.bytes,
        updated_at: nowIso(),
      });
    } catch (err) {
      if (err instanceof BakeUnavailableError) {
        // 424: the request is fine, the environment just cannot render — say which, because the
        // fix (install Chrome / set CHROME_PATH) is the operator's, not the user's.
        request.log.warn({ err: err.message, id, n }, 'react slide bake unavailable');
        return reply.code(424).send(errorResponse('BAKE_UNAVAILABLE', err.message));
      }
      request.log.warn({ err, id, n }, 'react slide bake failed');
      return reply
        .code(502)
        .send(errorResponse('BAKE_FAILED', err instanceof Error ? err.message : '產生投影片圖片失敗'));
    }
  });

  // GET whether a background bake for this page is still running (the editor polls this after a save).
  app.get('/api/pdfs/:id/pages/:n/react-slide/bake', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的頁面'));
    }
    return reply.header('Cache-Control', 'no-store').code(200).send({ page_number: n, pending: isBakePending(id, n) });
  });

  // GET the deck-wide theme (defaults when none saved yet).
  app.get('/api/pdfs/:id/slide-theme', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id'));
    }
    const { id } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報'));
    }
    return reply.header('Cache-Control', 'no-store').code(200).send({ theme: readStoredTheme(id) });
  });

  // PUT the deck-wide theme. Unknown tokens and unsafe values are dropped by sanitizeSlideTheme.
  app.put('/api/pdfs/:id/slide-theme', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id'));
    }
    const { id } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
    const body = (request.body ?? {}) as { theme?: unknown };
    const theme = { ...sanitizeSlideTheme(body.theme), updated_at: nowIso() };
    await fs.promises.writeFile(slideThemePath(id), `${JSON.stringify(theme, null, 2)}\n`, 'utf8');
    return reply.code(200).send({ theme });
  });

  // POST: AI-generate a theme from one sentence.
  app.post('/api/pdfs/:id/slide-theme/generate', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id'));
    }
    const parsedBody = GenerateThemeBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'A non-empty prompt is required'));
    }
    const { id } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow || !canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
    if (replyIfLlmDisabled(reply)) return reply;
    let theme: SlideTheme;
    try {
      theme = await generateSlideTheme(parsedBody.data.prompt, deckTitle(id));
    } catch (err) {
      request.log.warn({ err, id }, 'slide theme generation failed');
      return reply.code(502).send(errorResponse('THEME_GENERATION_FAILED', 'AI 產生主題失敗，請稍後再試'));
    }
    theme = { ...theme, updated_at: nowIso() };
    await fs.promises.writeFile(slideThemePath(id), `${JSON.stringify(theme, null, 2)}\n`, 'utf8');
    return reply.code(200).send({ theme });
  });
}
