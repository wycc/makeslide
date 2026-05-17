import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { coverImagePath, coverThumbnailPath, pageThumbnailPath } from './storage';

export const PAGE_THUMBNAIL_WIDTH_PX = 360;
export const COVER_THUMBNAIL_WIDTH_PX = 320;

async function writeJpegThumbnail(sourcePath: string, thumbnailPath: string, width: number): Promise<string> {
  await fs.promises.mkdir(path.dirname(thumbnailPath), { recursive: true });
  await sharp(sourcePath)
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(thumbnailPath);
  return thumbnailPath;
}

export async function generatePageThumbnail(
  pdfId: string,
  pageNumber: number,
  pageCount: number,
  sourcePath: string,
): Promise<string> {
  return writeJpegThumbnail(sourcePath, pageThumbnailPath(pdfId, pageNumber, pageCount), PAGE_THUMBNAIL_WIDTH_PX);
}

export async function generateCoverThumbnail(pdfId: string, sourcePath = coverImagePath(pdfId)): Promise<string> {
  return writeJpegThumbnail(sourcePath, coverThumbnailPath(pdfId), COVER_THUMBNAIL_WIDTH_PX);
}

export async function ensurePageThumbnail(
  pdfId: string,
  pageNumber: number,
  pageCount: number,
  sourcePath: string,
): Promise<string | null> {
  const thumbnailPath = pageThumbnailPath(pdfId, pageNumber, pageCount);
  if (fs.existsSync(thumbnailPath)) return thumbnailPath;
  if (!fs.existsSync(sourcePath)) return null;
  return generatePageThumbnail(pdfId, pageNumber, pageCount, sourcePath);
}

export async function ensureCoverThumbnail(pdfId: string, sourcePath = coverImagePath(pdfId)): Promise<string | null> {
  const thumbnailPath = coverThumbnailPath(pdfId);
  if (fs.existsSync(thumbnailPath)) return thumbnailPath;
  if (!fs.existsSync(sourcePath)) return null;
  return generateCoverThumbnail(pdfId, sourcePath);
}
