import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import type { PdfMetadata } from '../types';

export function ensureStorageRoot(): void {
  fs.mkdirSync(config.storageRoot, { recursive: true });
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}

export function pdfDir(pdfId: string): string {
  return path.join(config.storageRoot, pdfId);
}

export function pagesDir(pdfId: string): string {
  return path.join(pdfDir(pdfId), 'pages');
}

export function sourcePdfPath(pdfId: string): string {
  return path.join(pdfDir(pdfId), 'source.pdf');
}

export function sourceTextPath(pdfId: string): string {
  return path.join(pdfDir(pdfId), 'source.txt');
}

export function metadataPath(pdfId: string): string {
  return path.join(pdfDir(pdfId), 'metadata.json');
}

export function coverImagePath(pdfId: string): string {
  return path.join(pdfDir(pdfId), 'cover.jpg');
}

export function coverThumbnailPath(pdfId: string): string {
  return path.join(pdfDir(pdfId), 'cover.thumb.jpg');
}

/**
 * Width of the zero-padding used in page filenames (e.g. 001.jpg). 3 digits by
 * default, auto-expands to 4 for PDFs with > 999 pages.
 */
export function pagePad(pageCount: number): number {
  return pageCount > 999 ? 4 : 3;
}

export function formatPageNumber(pageNumber: number, pageCount: number): string {
  return String(pageNumber).padStart(pagePad(pageCount), '0');
}

export function pageImagePath(
  pdfId: string,
  pageNumber: number,
  pageCount: number,
): string {
  return path.join(
    pagesDir(pdfId),
    `${formatPageNumber(pageNumber, pageCount)}.jpg`,
  );
}

export function pageThumbnailPath(
  pdfId: string,
  pageNumber: number,
  pageCount: number,
): string {
  return path.join(
    pagesDir(pdfId),
    `${formatPageNumber(pageNumber, pageCount)}.thumb.jpg`,
  );
}

export function pageTextPath(
  pdfId: string,
  pageNumber: number,
  pageCount: number,
): string {
  return path.join(
    pagesDir(pdfId),
    `${formatPageNumber(pageNumber, pageCount)}.text.txt`,
  );
}

export function pageScriptPath(
  pdfId: string,
  pageNumber: number,
  pageCount: number,
): string {
  return path.join(
    pagesDir(pdfId),
    `${formatPageNumber(pageNumber, pageCount)}.script.txt`,
  );
}

export function pageAudioPath(
  pdfId: string,
  pageNumber: number,
  pageCount: number,
): string {
  return path.join(
    pagesDir(pdfId),
    `${formatPageNumber(pageNumber, pageCount)}.mp3`,
  );
}

export function videoPath(pdfId: string): string {
  return path.join(pdfDir(pdfId), 'video.mp4');
}

export function youtubeCaptionsRawPath(pdfId: string): string {
  return path.join(pdfDir(pdfId), 'captions.raw.json');
}

export function youtubeCaptionsNormalizedPath(pdfId: string): string {
  return path.join(pdfDir(pdfId), 'captions.normalized.txt');
}

export function youtubeOutlinePath(pdfId: string): string {
  return path.join(pdfDir(pdfId), 'outline.md');
}

export function createPdfDir(pdfId: string): string {
  const dir = pdfDir(pdfId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  return dir;
}

export async function writeSourcePdf(pdfId: string, buffer: Buffer): Promise<void> {
  await fs.promises.writeFile(sourcePdfPath(pdfId), buffer);
}

export async function writeSourceText(pdfId: string, text: string): Promise<void> {
  await fs.promises.writeFile(sourceTextPath(pdfId), text, 'utf8');
}

export async function writeMetadata(pdfId: string, metadata: PdfMetadata): Promise<void> {
  await fs.promises.writeFile(
    metadataPath(pdfId),
    JSON.stringify(metadata, null, 2),
    'utf8',
  );
}

export async function readMetadata(pdfId: string): Promise<PdfMetadata | null> {
  try {
    const raw = await fs.promises.readFile(metadataPath(pdfId), 'utf8');
    return JSON.parse(raw) as PdfMetadata;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function removePdfDir(pdfId: string): Promise<void> {
  const dir = pdfDir(pdfId);
  await fs.promises.rm(dir, { recursive: true, force: true });
}

export async function renumberPageArtifacts(
  pdfId: string,
  oldPageCount: number,
  updates: Array<{ from: number; to: number }>,
): Promise<void> {
  if (updates.length === 0) return;
  const dir = pagesDir(pdfId);
  await fs.promises.mkdir(dir, { recursive: true });

  const suffixes = ['.jpg', '.thumb.jpg', '.png', '.text.txt', '.script.txt', '.mp3'] as const;
  const tempMoves: Array<{ from: string; to: string }> = [];

  for (const item of updates) {
    const fromPad = formatPageNumber(item.from, oldPageCount);
    const toPad = formatPageNumber(item.to, oldPageCount);
    for (const suffix of suffixes) {
      const from = path.join(dir, `${fromPad}${suffix}`);
      const tmp = path.join(dir, `.__renaming__.${toPad}${suffix}`);
      try {
        await fs.promises.access(from, fs.constants.F_OK);
      } catch {
        continue;
      }
      await fs.promises.rename(from, tmp);
      tempMoves.push({ from: tmp, to: path.join(dir, `${toPad}${suffix}`) });
    }
  }

  for (const mv of tempMoves) {
    await fs.promises.rename(mv.from, mv.to);
  }
}

/**
 * Resolve a file path inside a pdf's storage dir and ensure it cannot escape
 * that directory (defence against path traversal). Returns the absolute path,
 * or throws if the resolved path is outside the pdf dir.
 */
export function safeJoinPdfPath(pdfId: string, ...segments: string[]): string {
  const base = pdfDir(pdfId);
  const resolved = path.resolve(base, ...segments);
  const normalizedBase = path.resolve(base) + path.sep;
  if (!(resolved + path.sep).startsWith(normalizedBase) && resolved !== path.resolve(base)) {
    throw new Error(`Path traversal detected: ${segments.join('/')}`);
  }
  return resolved;
}
