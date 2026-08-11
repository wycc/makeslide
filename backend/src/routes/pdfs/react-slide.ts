import fs from 'node:fs';
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
import { withImageProviderFailover, imageEditTimeoutMs, describeImageEditFailure } from './page-operations';
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

const GenerateReactSlideBodySchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_REACT_SLIDE_PROMPT_LENGTH),
  /** Keep the user's per-element text/CSS tweaks; off by default because a new layout usually invalidates them. */
  keepOverrides: z.boolean().optional(),
});

const GenerateBackgroundBodySchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_REACT_SLIDE_PROMPT_LENGTH),
  overlayOpacity: z.number().min(0).max(1).optional(),
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
 * Persist code (+ its compiled output) to a page and flip it to a React slide.
 *
 * `image_path` is deliberately left alone: it still points at the page's JPG, which every
 * image-shaped consumer (thumbnails, PDF/PPTX/video export, cover) keeps using and which the
 * renderer falls back to when the sandbox cannot run — see the design doc §3.1.
 */
async function writeReactSlideForPage(
  id: string,
  n: number,
  pageUid: string,
  code: string,
  compiled: string,
): Promise<{ relSourcePath: string; now: string }> {
  const relSourcePath = `pages/${pageUid}.slide.jsx`;
  await fs.promises.writeFile(pageReactSlideSourcePath(id, pageUid), code, 'utf8');
  await fs.promises.writeFile(pageReactSlideCompiledPath(id, pageUid), compiled, 'utf8');
  const now = nowIso();
  db.prepare(
    `UPDATE pages SET render_type = 'react', react_slide_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
  ).run(relSourcePath, now, id, n);
  try {
    const meta = await readMetadata(id);
    if (meta) {
      const page = meta.pages.find((p) => p.page_number === n);
      if (page) {
        page.render_type = 'react';
        page.react_slide_path = relSourcePath;
      }
      meta.updated_at = now;
      await writeMetadata(id, meta);
    }
  } catch {
    // non-fatal: metadata.json is a derived snapshot of the DB
  }
  return { relSourcePath, now };
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
    if (parsedBody.data.code !== undefined) {
      const validation = await validateAndCompileReactSlide(parsedBody.data.code);
      if (!validation.ok || !validation.compiled) {
        return reply
          .code(422)
          .send(errorResponse('REACT_SLIDE_INVALID', validation.message ?? 'Slide code is invalid'));
      }
      ({ now } = await writeReactSlideForPage(id, n, row.page_uid, parsedBody.data.code, validation.compiled));
    }
    let config = readStoredConfig(id, row.page_uid);
    if (parsedBody.data.config !== undefined) {
      config = { ...sanitizeReactSlideConfig(parsedBody.data.config), updated_at: now };
      await writeStoredConfig(id, row.page_uid, config);
    }
    return reply.code(200).send({
      page_number: n,
      render_type: parsedBody.data.code !== undefined ? 'react' : (row.render_type ?? 'static-image'),
      config,
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
        theme,
      });
    } catch (err) {
      request.log.warn({ err, id, n }, 'react slide generation failed');
      return reply
        .code(502)
        .send(errorResponse('REACT_SLIDE_GENERATION_FAILED', 'AI 產生 React 投影片失敗，請稍後再試'));
    }
    const { now } = await writeReactSlideForPage(id, n, row.page_uid, generated.code, generated.compiled);

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
    return reply.code(200).send({ page_number: n, config, updated_at: now });
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
