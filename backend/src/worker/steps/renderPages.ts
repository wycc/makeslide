import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { nanoid } from 'nanoid';
import { config } from '../../config';
import { logger } from '../../logger';
import {
  coverImagePath,
  pageImagePath,
  pagesDir,
  sourcePdfPath,
} from '../../services/storage';
import { renderPdfPages } from '../poppler';
import { generateCoverThumbnail, generatePageThumbnail } from '../../services/thumbnails';

const COVER_WIDTH_PX = 400;
const PAGE_JPEG_QUALITY = 72;

export interface RenderResult {
  pageCount: number;
  /** Absolute paths of the per-page JPEGs, indexed by `pageNumber - 1`. */
  pagePaths: string[];
  /** Stable page_uid generated for each page, indexed by `pageNumber - 1`. */
  pageUids: string[];
  coverPath: string;
}

/**
 * Render every page of a PDF to `storage/<pdfId>/pages/<page_uid>.jpg` using
 * the `pdftoppm` (Poppler) binary, then produce a cover thumbnail from page 1.
 */
export async function renderPages(pdfId: string): Promise<RenderResult> {
  const source = sourcePdfPath(pdfId);
  if (!fs.existsSync(source)) {
    throw new Error(`Source PDF missing: ${source}`);
  }

  const outDir = pagesDir(pdfId);
  fs.mkdirSync(outDir, { recursive: true });

  // Clean any pre-existing rendered images.
  for (const entry of fs.readdirSync(outDir)) {
    if (/\.(png|jpg|jpeg)$/i.test(entry)) {
      fs.unlinkSync(path.join(outDir, entry));
    }
  }

  logger.info({ pdfId, dpi: config.renderDpi }, 'Rendering PDF pages via pdfjs-dist');
  const { pageCount, pages } = await renderPdfPages(source, config.renderDpi);

  if (pageCount <= 0) throw new Error('PDF has no pages');
  if (pages.length !== pageCount) {
    throw new Error(`pdfjs rendered ${pages.length} pages but reported ${pageCount}`);
  }

  const pagePaths: string[] = [];
  const pageUids: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const pageUid = nanoid(10);
    const jpgOut = pageImagePath(pdfId, pageUid);
    await sharp(pages[i])
      .jpeg({ quality: PAGE_JPEG_QUALITY, mozjpeg: true })
      .toFile(jpgOut);
    await generatePageThumbnail(pdfId, pageUid, jpgOut);
    pagePaths.push(jpgOut);
    pageUids.push(pageUid);
  }

  // Build cover from page 1
  const coverPath = coverImagePath(pdfId);
  await sharp(pagePaths[0])
    .resize({ width: COVER_WIDTH_PX, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(coverPath);
  await generateCoverThumbnail(pdfId, coverPath);

  logger.info({ pdfId, pageCount, coverPath }, 'Rendered pages and cover');

  return { pageCount, pagePaths, pageUids, coverPath };
}
