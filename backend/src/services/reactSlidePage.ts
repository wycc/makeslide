import fs from 'node:fs';
import { db } from '../db';
import { logger } from '../logger';
import {
  pageReactSlideCompiledPath,
  pageReactSlideConfigPath,
  pageReactSlideSourcePath,
  readMetadata,
  safeJoinPdfPath,
  slideThemePath,
  writeMetadata,
} from './storage';
import {
  defaultSlideTheme,
  generateReactSlideCode,
  parseStoredSlideTheme,
  type SlideTheme,
} from './reactSlide';

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
): Promise<{ relSourcePath: string }> {
  const relSourcePath = `pages/${pageUid}.slide.jsx`;
  await fs.promises.writeFile(pageReactSlideSourcePath(pdfId, pageUid), code, 'utf8');
  await fs.promises.writeFile(pageReactSlideCompiledPath(pdfId, pageUid), compiled, 'utf8');
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
  return { relSourcePath };
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
