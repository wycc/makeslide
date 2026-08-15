import fs from 'node:fs';
import sharp from 'sharp';
import { db } from '../db';
import { logger } from '../logger';
import {
  pageImagePath,
  pageReactSlideBackgroundPath,
  pageReactSlideCompiledPath,
  pageReactSlideConfigPath,
  pageReactSlideSourcePath,
  readMetadata,
  safeJoinPdfPath,
  slideThemePath,
  writeMetadata,
} from './storage';
import {
  compileReactSlide,
  defaultSlideTheme,
  generateReactSlideCode,
  parseStoredSlideTheme,
  validateAndCompileReactSlide,
  type ReactSlideBackground,
  type SlideTheme,
} from './reactSlide';
import { ensureElementIds } from './reactSlideEdit';

/**
 * Page-level operations on React slides that more than one caller needs: the HTTP routes
 * (routes/pdfs/react-slide.ts) and the regenerate worker both persist generated code and both
 * need the deck outline that conditions generation.
 *
 * Kept apart from services/reactSlide.ts, which stays free of DB/filesystem concerns so its
 * validation and prompt building can be unit-tested without a database.
 */

/** Reads the deck-wide theme, falling back to the default when none has been saved. */
export function readStoredSlideTheme(pdfId: string): SlideTheme {
  try {
    return parseStoredSlideTheme(fs.readFileSync(slideThemePath(pdfId), 'utf8'));
  } catch {
    return defaultSlideTheme();
  }
}

/**
 * Persist code (+ its compiled output) to a page and flip it to a React slide.
 *
 * `image_path` is deliberately left alone: it still points at the page's JPG, which every
 * image-shaped consumer (thumbnails, PDF/PPTX/video export, cover) keeps using and which the
 * renderer falls back to when the sandbox cannot run — see docs/react-slide-design.md §3.1.
 */
export async function writeReactSlideForPage(
  pdfId: string,
  pageNumber: number,
  pageUid: string,
  code: string,
  compiled: string,
  now: string,
): Promise<{ relSourcePath: string; code: string; compiled: string }> {
  const relSourcePath = `pages/${pageUid}.slide.jsx`;
  // Every element gets an id on the way in — generated, hand-edited or restored alike — because
  // that id is how an edit finds its element later. Doing it here rather than at each call site
  // means a path that forgets cannot exist. Recompiling is only needed when ids were added, and
  // a page whose ids are already there (the common case) pays nothing.
  const withIds = ensureElementIds(code);
  let sourceCode = code;
  let compiledCode = compiled;
  if (withIds.changed) {
    sourceCode = withIds.code;
    try {
      compiledCode = (await compileReactSlide(sourceCode)).code;
    } catch (err) {
      // The caller already compiled the original successfully, so this can only mean the id
      // injection produced something invalid. Store the original rather than a broken page.
      logger.warn({ pdfId, pageNumber, err }, 'react slide: could not compile after adding element ids');
      sourceCode = code;
      compiledCode = compiled;
    }
  }
  await fs.promises.writeFile(pageReactSlideSourcePath(pdfId, pageUid), sourceCode, 'utf8');
  await fs.promises.writeFile(pageReactSlideCompiledPath(pdfId, pageUid), compiledCode, 'utf8');
  db.prepare(
    `UPDATE pages SET render_type = 'react', react_slide_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
  ).run(relSourcePath, now, pdfId, pageNumber);
  try {
    const meta = await readMetadata(pdfId);
    if (meta) {
      const page = meta.pages.find((p) => p.page_number === pageNumber);
      if (page) {
        page.render_type = 'react';
        page.react_slide_path = relSourcePath;
      }
      meta.updated_at = now;
      await writeMetadata(pdfId, meta);
    }
  } catch {
    // non-fatal: metadata.json is a derived snapshot of the DB
  }
  return { relSourcePath, code: sourceCode, compiled: compiledCode };
}

/** Scrim over an adopted page image: enough for new text to read, light enough to still see it. */
const ADOPTED_BACKGROUND_OVERLAY_OPACITY = 0.35;

/**
 * Turn the page's existing slide image into the React page's background.
 *
 * Converting a page to React otherwise throws its picture away visually: the page still holds the
 * JPG (exports use it), but the viewer sees a blank canvas with whatever the skeleton draws, and
 * everything the slide used to show is gone from the screen. Adopting it as the background keeps
 * the conversion additive — the old slide is still there, with the React layer composed on top.
 *
 * It is *copied*, not referenced: baking (§9.1) writes the rendered React page back to that same
 * JPG, so a background pointing at it would feed each bake into the next one and compound.
 *
 * Returns null when there is nothing to adopt, leaving the caller's config untouched.
 */
export async function adoptPageImageAsBackground(
  pdfId: string,
  pageUid: string,
  theme: SlideTheme,
): Promise<ReactSlideBackground | null> {
  const source = pageImagePath(pdfId, pageUid);
  if (!fs.existsSync(source)) return null;
  try {
    await sharp(source).png().toFile(pageReactSlideBackgroundPath(pdfId, pageUid));
  } catch (err) {
    logger.warn({ err, pdfId, pageUid }, 'could not adopt the page image as the React background');
    return null;
  }
  return {
    mode: 'image',
    file: `pages/${pageUid}.slide-bg.png`,
    fit: 'cover',
    overlayColor: theme.tokens['--slide-bg'],
    overlayOpacity: ADOPTED_BACKGROUND_OVERLAY_OPACITY,
  };
}

/** How many pages the outline may list, and how much of each page's transcript it may quote. */
const OUTLINE_MAX_PAGES = 60;
const OUTLINE_CHARS_PER_PAGE = 80;

/**
 * A one-line-per-page summary of the whole deck, used as context when (re)generating a page's
 * React code.
 *
 * Without it every page is written in isolation, and a deck ends up with a title slide that
 * repeats the agenda, three pages that each re-introduce the same concept, and no sense of where
 * this page sits in the talk. The outline is deliberately terse — the first sentence or so of each
 * page's transcript — because the point is "what the rest of the deck covers", not the content
 * itself; the page being generated gets its own full transcript separately.
 */
export function buildDeckOutline(pdfId: string, currentPageNumber?: number): string {
  const row = db.prepare(`SELECT title, description, user_prompt FROM pdfs WHERE id = ?`).get(pdfId) as
    | { title: string | null; description: string | null; user_prompt: string | null }
    | undefined;
  const pages = db
    .prepare(`SELECT page_number, script_path, text_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(pdfId) as Array<{ page_number: number; script_path: string | null; text_path: string | null }>;

  const lines: string[] = [];
  if (row?.title) lines.push(`簡報標題：${row.title}`);
  if (row?.description) lines.push(`簡報說明：${row.description.trim().slice(0, 300)}`);
  if (row?.user_prompt) lines.push(`簡報主旨：${row.user_prompt.trim().slice(0, 300)}`);
  if (pages.length > 0) lines.push('', `全篇大綱（共 ${pages.length} 頁）：`);

  for (const page of pages.slice(0, OUTLINE_MAX_PAGES)) {
    let summary = '';
    for (const relPath of [page.script_path, page.text_path]) {
      if (summary || !relPath) continue;
      try {
        summary = fs.readFileSync(safeJoinPdfPath(pdfId, relPath), 'utf8').replace(/\s+/g, ' ').trim();
      } catch {
        summary = '';
      }
    }
    const marker = page.page_number === currentPageNumber ? '★ ' : '';
    lines.push(`${marker}第 ${page.page_number} 頁：${summary.slice(0, OUTLINE_CHARS_PER_PAGE) || '（尚無內容）'}`);
  }
  if (pages.length > OUTLINE_MAX_PAGES) {
    lines.push(`…（其餘 ${pages.length - OUTLINE_MAX_PAGES} 頁省略）`);
  }
  if (currentPageNumber != null) {
    lines.push('', `★ 標記的是這次要產生的頁面。請只做這一頁，不要把其他頁的內容也塞進來。`);
  }
  return lines.join('\n');
}

export interface ImportedReactSlideRecompileResult {
  /** Pages whose `.slide.js` was rebuilt from their own source. */
  recompiled: number[];
  /** Pages whose source failed validation; their stale `.slide.js` was removed. */
  rejected: number[];
}

/**
 * Rebuild every imported React page's compiled output from its own source.
 *
 * A `.slide.js` arriving in an export ZIP is the *exporting* site's compiled output, and nothing on
 * the import path ever looked at it — while the sandbox runs precisely that file (the read route
 * only compiles when it is missing). A hand-built ZIP could therefore carry a harmless-looking
 * `.slide.jsx` next to a `.slide.js` that is something else entirely, and the deny list applied
 * when code is saved never sees this path at all.
 *
 * Recompiling makes the source the only thing that decides what runs: `validateAndCompileReactSlide`
 * applies the same length cap, deny list and `window.SlideComponent` contract check that a normal
 * save does, so an imported page executes exactly what saving that source here would have produced.
 *
 * A page whose source will not compile has its stale `.slide.js` **deleted** rather than left
 * alone — leaving it is the whole bug. The page keeps its source (so it can be repaired) and its
 * JPG (so it still shows something), and the read route recompiles on demand from then on.
 */
export async function recompileImportedReactSlides(
  pdfId: string,
  pageNumbers: number[],
  log?: { warn: (obj: Record<string, unknown>, msg: string) => void },
): Promise<ImportedReactSlideRecompileResult> {
  const result: ImportedReactSlideRecompileResult = { recompiled: [], rejected: [] };
  if (pageNumbers.length === 0) return result;
  const rows = db
    .prepare(`SELECT page_number, page_uid, react_slide_path FROM pages WHERE pdf_id = ?`)
    .all(pdfId) as Array<{ page_number: number; page_uid: string; react_slide_path: string | null }>;
  const byNumber = new Map(rows.map((row) => [row.page_number, row]));

  for (const pageNumber of pageNumbers) {
    const row = byNumber.get(pageNumber);
    if (!row) continue;
    const compiledPath = pageReactSlideCompiledPath(pdfId, row.page_uid);
    let source = '';
    try {
      // `react_slide_path` comes from the ZIP, so it is resolved through safeJoinPdfPath rather
      // than trusted; a path pointing outside the deck throws and is treated as unreadable.
      const sourcePath = row.react_slide_path
        ? safeJoinPdfPath(pdfId, row.react_slide_path)
        : pageReactSlideSourcePath(pdfId, row.page_uid);
      source = await fs.promises.readFile(sourcePath, 'utf8');
    } catch {
      source = '';
    }
    const validation = source ? await validateAndCompileReactSlide(source) : { ok: false as const };
    if (validation.ok && 'compiled' in validation && validation.compiled) {
      await fs.promises.writeFile(compiledPath, validation.compiled, 'utf8');
      result.recompiled.push(pageNumber);
      continue;
    }
    await fs.promises.rm(compiledPath, { force: true });
    result.rejected.push(pageNumber);
    log?.warn(
      { pdfId, pageNumber, reason: 'message' in validation ? validation.message : 'source unreadable' },
      'import: discarded an imported React slide whose source does not compile',
    );
  }
  return result;
}

export interface ReactSlideRegenerationPage {
  page_number: number;
  page_uid: string;
  script_path: string | null;
  text_path: string | null;
}

function readPageFile(pdfId: string, relPath: string | null): string {
  if (!relPath) return '';
  try {
    return fs.readFileSync(safeJoinPdfPath(pdfId, relPath), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Rewrite one React page's code from the deck outline, the page's own transcript/text and the
 * user's regeneration prompt, then persist it.
 *
 * This is what "regenerate images" means for a React page: its picture is not a file to redraw
 * but code to rewrite, so the image step would otherwise either fail or spend real money
 * producing a JPG the page never displays.
 *
 * The page's existing code is deliberately NOT passed in: a regeneration run is asking for the
 * page to be redone from the current transcript, and feeding the old layout back would anchor
 * the result to a version whose content may no longer match. Per-element overrides are cleared
 * for the same reason as the interactive generate route — element paths follow structure, so a
 * new layout makes them point at the wrong things.
 */
export async function regenerateReactSlideForPage(
  pdfId: string,
  page: ReactSlideRegenerationPage,
  userPrompt: string,
  now: string,
): Promise<void> {
  const theme = readStoredSlideTheme(pdfId);
  const generated = await generateReactSlideCode({
    prompt: userPrompt,
    deckOutline: buildDeckOutline(pdfId, page.page_number),
    pageText: readPageFile(pdfId, page.text_path),
    pageScript: readPageFile(pdfId, page.script_path),
    theme,
  });
  await writeReactSlideForPage(pdfId, page.page_number, page.page_uid, generated.code, generated.compiled, now);

  const configPath = pageReactSlideConfigPath(pdfId, page.page_uid);
  try {
    const raw = await fs.promises.readFile(configPath, 'utf8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    await fs.promises.writeFile(
      configPath,
      `${JSON.stringify({ ...config, prompt: userPrompt, overrides: {}, updated_at: now }, null, 2)}\n`,
      'utf8',
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ err, pdfId, pageNumber: page.page_number }, 'regenerate(react): failed to reset page config');
    }
  }
}
