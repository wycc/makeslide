import fs from 'node:fs';
import path from 'node:path';
import { figureManifestPath, pdfDir } from './storage';
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

/** Cap on how many extracted figures are attached as reference images per image-generation request. */
const MAX_FIGURE_REFERENCES_PER_PAGE = 2;

/**
 * Returns the figures for `pageNumber` that should be attached as reference
 * images when (re)generating that page's slide image, largest-area first and
 * capped to `MAX_FIGURE_REFERENCES_PER_PAGE`.
 */
export function getFigureReferencesForPage(pdfId: string, pageNumber: number, max = MAX_FIGURE_REFERENCES_PER_PAGE): FigureEntry[] {
  const figures = getPageFigures(pdfId, pageNumber);
  if (figures.length <= max) return figures;
  return [...figures]
    .sort((a, b) => b.bbox.widthPct * b.bbox.heightPct - a.bbox.widthPct * a.bbox.heightPct)
    .slice(0, max);
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
