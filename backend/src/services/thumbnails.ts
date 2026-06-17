import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { coverImagePath, coverThumbnailPath, pageThumbnailPath } from './storage';

export const PAGE_THUMBNAIL_WIDTH_PX = 749;
export const PAGE_THUMBNAIL_HEIGHT_PX = 500;
export const PAGE_THUMBNAIL_JPEG_QUALITY = 62;
export const COVER_THUMBNAIL_WIDTH_PX = 320;

async function writeJpegThumbnail(
  sourcePath: string,
  thumbnailPath: string,
  options: { width: number; height?: number; quality?: number },
): Promise<string> {
  await fs.promises.mkdir(path.dirname(thumbnailPath), { recursive: true });
  await sharp(sourcePath)
    .resize({
      width: options.width,
      height: options.height,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: options.quality ?? 72, mozjpeg: true })
    .toFile(thumbnailPath);
  return thumbnailPath;
}

export async function generatePageThumbnail(
  pdfId: string,
  pageUid: string,
  sourcePath: string,
): Promise<string> {
  return writeJpegThumbnail(sourcePath, pageThumbnailPath(pdfId, pageUid), {
    width: PAGE_THUMBNAIL_WIDTH_PX,
    height: PAGE_THUMBNAIL_HEIGHT_PX,
    quality: PAGE_THUMBNAIL_JPEG_QUALITY,
  });
}

export async function generateCoverThumbnail(pdfId: string, sourcePath = coverImagePath(pdfId)): Promise<string> {
  return writeJpegThumbnail(sourcePath, coverThumbnailPath(pdfId), { width: COVER_THUMBNAIL_WIDTH_PX });
}

export async function ensurePageThumbnail(
  pdfId: string,
  pageUid: string,
  sourcePath: string,
): Promise<string | null> {
  const thumbnailPath = pageThumbnailPath(pdfId, pageUid);
  if (fs.existsSync(thumbnailPath)) return thumbnailPath;
  if (!fs.existsSync(sourcePath)) return null;
  return generatePageThumbnail(pdfId, pageUid, sourcePath);
}

export async function ensureCoverThumbnail(pdfId: string, sourcePath = coverImagePath(pdfId)): Promise<string | null> {
  const thumbnailPath = coverThumbnailPath(pdfId);
  if (fs.existsSync(thumbnailPath)) return thumbnailPath;
  if (!fs.existsSync(sourcePath)) return null;
  return generateCoverThumbnail(pdfId, sourcePath);
}
