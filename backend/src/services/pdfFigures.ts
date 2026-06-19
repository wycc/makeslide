import fs from 'node:fs';
import path from 'node:path';
import { toFile } from 'openai';
import { logger } from '../logger';
import { figureManifestPath, figureSelectionPath, pdfDir, splitFigureMapPath } from './storage';
import type { FigureEntry, FigureManifest } from '../worker/steps/extractPdfFigures';

/** Loads `storage/<pdfId>/figures.json`, or `null` if it doesn't exist (not a PDF import, or extraction hasn't run yet). */
export function loadFigureManifest(pdfId: string): FigureManifest | null {
  try {
    const raw = fs.readFileSync(figureManifestPath(pdfId), 'utf8');
    return JSON.parse(raw) as FigureManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Returns the figures extracted for a given page, or `[]` if none / no manifest. */
export function getPageFigures(pdfId: string, pageNumber: number): FigureEntry[] {
  const manifest = loadFigureManifest(pdfId);
  return manifest?.pages.find((p) => p.pageNumber === pageNumber)?.figures ?? [];
}

/** Resolves a figure's `imagePath` to an absolute path on disk. */
export function figureImageAbsPath(pdfId: string, figure: FigureEntry): string {
  return path.join(pdfDir(pdfId), figure.imagePath);
}

/**
 * Reads each figure's image file and wraps it as an uploadable `File` for an
 * OpenAI image-generation request. A figure whose image file is missing or
 * unreadable (e.g. removed by a later cleanup pass while `figures.json`
 * still references it) is skipped with a warning instead of failing the
 * whole batch — figure references are a "nice to have" visual aid, not a
 * hard requirement for generating the slide. Returns the subset of `figures`
 * that were actually loaded alongside their files, in matching order, so
 * callers can build caption notes from the same set that was attached.
 */
export async function loadFigureReferenceFiles(
  pdfId: string,
  figures: FigureEntry[],
): Promise<{ figures: FigureEntry[]; files: Awaited<ReturnType<typeof toFile>>[] }> {
  const loaded = await Promise.all(
    figures.map(async (figure, index) => {
      const imagePath = figureImageAbsPath(pdfId, figure);
      try {
        const buf = await fs.promises.readFile(imagePath);
        const file = await toFile(buf, `figure-ref-${index + 1}.png`, { type: 'image/png' });
        return { figure, file };
      } catch (err) {
        logger.warn(
          { pdfId, figureId: figure.id, imagePath, err: err instanceof Error ? err.message : String(err) },
          'pdfFigures: failed to load figure reference image, skipping',
        );
        return null;
      }
    }),
  );
  const present = loaded.filter((entry): entry is { figure: FigureEntry; file: Awaited<ReturnType<typeof toFile>> } => entry !== null);
  return { figures: present.map((entry) => entry.figure), files: present.map((entry) => entry.file) };
}

/** Finds a single figure by its stable id, searching across all pages of the manifest. Returns `null` if not found / no manifest. */
export function findFigureById(pdfId: string, figureId: string): FigureEntry | null {
  const manifest = loadFigureManifest(pdfId);
  if (!manifest) return null;
  for (const page of manifest.pages) {
    const found = page.figures.find((figure) => figure.id === figureId);
    if (found) return found;
  }
  return null;
}

/** Cap on how many extracted figures are attached as reference images per image-generation request. */
const MAX_FIGURE_REFERENCES_PER_PAGE = 2;

/** Sorts `figures` largest-area-first and caps the result to `max` entries. */
function capFiguresByArea(figures: FigureEntry[], max: number): FigureEntry[] {
  if (figures.length <= max) return figures;
  return [...figures]
    .sort((a, b) => b.bbox.widthPct * b.bbox.heightPct - a.bbox.widthPct * a.bbox.heightPct)
    .slice(0, max);
}

/**
 * Returns the figures for `pageNumber` that should be attached as reference
 * images when (re)generating that page's slide image, largest-area first and
 * capped to `MAX_FIGURE_REFERENCES_PER_PAGE`. Figures whose id is in
 * `excludeIds` (user-deselected via the figure-asset browser) are dropped
 * before capping, so excluding a large figure can surface the next-largest one.
 */
export function getFigureReferencesForPage(
  pdfId: string,
  pageNumber: number,
  max = MAX_FIGURE_REFERENCES_PER_PAGE,
  excludeIds?: ReadonlySet<string>,
): FigureEntry[] {
  const figures = getPageFigures(pdfId, pageNumber).filter((figure) => !excludeIds?.has(figure.id));
  return capFiguresByArea(figures, max);
}

/**
 * Like `getFigureReferencesForPage`, but aggregates figures across multiple
 * original PDF pages (deduped by figure id), for use when an AI-split
 * document-mode slide's content is drawn from more than one source page.
 */
export function getFigureReferencesForPages(
  pdfId: string,
  pageNumbers: number[],
  max = MAX_FIGURE_REFERENCES_PER_PAGE,
  excludeIds?: ReadonlySet<string>,
): FigureEntry[] {
  const seen = new Set<string>();
  const all: FigureEntry[] = [];
  for (const pageNumber of pageNumbers) {
    for (const figure of getPageFigures(pdfId, pageNumber)) {
      if (seen.has(figure.id) || excludeIds?.has(figure.id)) continue;
      seen.add(figure.id);
      all.push(figure);
    }
  }
  return capFiguresByArea(all, max);
}

/** Per-page record of which extracted figure ids the user excluded from use as image-generation references. */
export interface FigureSelection {
  excluded: string[];
}

/** Loads `pages/<pageUid>.figure-selection.json`, or `{ excluded: [] }` if it doesn't exist. */
export function loadFigureSelection(pdfId: string, pageUid: string): FigureSelection {
  try {
    const raw = fs.readFileSync(figureSelectionPath(pdfId, pageUid), 'utf8');
    const parsed = JSON.parse(raw) as Partial<FigureSelection>;
    return { excluded: Array.isArray(parsed.excluded) ? parsed.excluded.filter((id) => typeof id === 'string') : [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { excluded: [] };
    throw err;
  }
}

export function saveFigureSelection(pdfId: string, pageUid: string, selection: FigureSelection): void {
  fs.writeFileSync(figureSelectionPath(pdfId, pageUid), JSON.stringify(selection), 'utf8');
}

/**
 * Builds a prompt note describing the reference figures attached to the
 * request, so the LLM knows to preserve their information when (re)drawing
 * the slide. Returns `null` if `figures` is empty.
 */
export function buildFigureReferenceNotes(figures: FigureEntry[]): string | null {
  if (figures.length === 0) return null;
  const lines = figures.map((figure, index) => {
    const desc = figure.caption?.trim() || figure.context?.trim() || '(無圖說文字)';
    return `- 參考圖表 ${index + 1}：${desc}`;
  });
  return [
    '本頁對應的原始 PDF 內含以下圖表，並已作為額外參考圖片附加於本次請求：',
    ...lines,
    '請在生成的投影片圖片中盡量保留這些圖表的關鍵資訊、數據或趨勢，並以符合整體風格的方式重新呈現，不需要逐一複製其外觀。',
  ].join('\n');
}

/**
 * Maps AI-split slide page numbers (document-mode imports) to the original
 * PDF page number(s) their content was drawn from, as reported by
 * `splitTextWithLlm`'s outline step. Persisted alongside `figures.json` so
 * the mapping survives pipeline resumes (split pages aren't re-split).
 */
export type SplitPageFigureMap = Record<number, number[]>;

export function loadSplitPageFigureMap(pdfId: string): SplitPageFigureMap | null {
  try {
    const raw = fs.readFileSync(splitFigureMapPath(pdfId), 'utf8');
    return JSON.parse(raw) as SplitPageFigureMap;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export function saveSplitPageFigureMap(pdfId: string, map: SplitPageFigureMap): void {
  fs.writeFileSync(splitFigureMapPath(pdfId), JSON.stringify(map), 'utf8');
}
