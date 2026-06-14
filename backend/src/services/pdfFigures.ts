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
