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
 * Page artifact files are named after the page's stable `page_uid` (generated
 * once at creation and never changed) rather than its current page number.
 * This means reordering pages only ever updates `page_number` in the DB —
 * no file renames are needed, so git history (and `--follow`) continues to
 * track each slide's actual content regardless of where it currently sits.
 */
export function pageImagePath(pdfId: string, pageUid: string): string {
  return path.join(pagesDir(pdfId), `${pageUid}.jpg`);
}

export function pageThumbnailPath(pdfId: string, pageUid: string): string {
  return path.join(pagesDir(pdfId), `${pageUid}.thumb.jpg`);
}

export function pageTextPath(pdfId: string, pageUid: string): string {
  return path.join(pagesDir(pdfId), `${pageUid}.text.txt`);
}

export function pageScriptPath(pdfId: string, pageUid: string): string {
  return path.join(pagesDir(pdfId), `${pageUid}.script.txt`);
}

export function pageAudioPath(pdfId: string, pageUid: string): string {
  return path.join(pagesDir(pdfId), `${pageUid}.m4a`);
}

export function pageAnimationSpecPath(pdfId: string, pageUid: string): string {
  return path.join(pagesDir(pdfId), `${pageUid}.animation.json`);
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
