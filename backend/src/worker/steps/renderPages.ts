import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../../config';
import { logger } from '../../logger';
import {
  coverImagePath,
  formatPageNumber,
  pagesDir,
  sourcePdfPath,
} from '../../services/storage';
import { renderPdfPages } from '../poppler';
import { generateCoverThumbnail, generatePageThumbnail } from '../../services/thumbnails';

const COVER_WIDTH_PX = 400;

export interface RenderResult {
  pageCount: number;
  /** Absolute paths of the per-page JPEGs, indexed by `pageNumber - 1`. */
  pagePaths: string[];
  coverPath: string;
}

/**
 * Render every page of a PDF to `storage/<pdfId>/pages/NNN.jpg` using
 * pdfjs-dist + canvas, then produce a cover thumbnail from page 1.
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
  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const jpgOut = path.join(outDir, `${formatPageNumber(pageNumber, pageCount)}.jpg`);
    await sharp(pages[i])
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(jpgOut);
    await generatePageThumbnail(pdfId, pageNumber, pageCount, jpgOut);
    pagePaths.push(jpgOut);
  }

  // Build cover from page 1
  const coverPath = coverImagePath(pdfId);
  await sharp(pagePaths[0])
    .resize({ width: COVER_WIDTH_PX, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(coverPath);
  await generateCoverThumbnail(pdfId, coverPath);

  logger.info({ pdfId, pageCount, coverPath }, 'Rendered pages and cover');

  return { pageCount, pagePaths, coverPath };
}
