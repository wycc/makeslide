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
import { getPdfPageCount, pdftoppmBin, runCommand } from '../poppler';
import { generateCoverThumbnail, generatePageThumbnail } from '../../services/thumbnails';

const COVER_WIDTH_PX = 400;

export interface RenderResult {
  pageCount: number;
  /** Absolute paths of the per-page PNGs, indexed by `pageNumber - 1`. */
  pagePaths: string[];
  coverPath: string;
}

/**
 * Render every page of a PDF to `storage/<pdfId>/pages/NNN.jpg` using
 * `pdftoppm`, then produce a cover thumbnail `cover.jpg` from page 1.
 *
 * pdftoppm pads numeric suffixes to the width of the largest page number, so
 * we rename each output file to the fixed width our API / storage layout
 * expects (3 digits, or 4 digits for PDFs > 999 pages).
 */
export async function renderPages(pdfId: string): Promise<RenderResult> {
  const source = sourcePdfPath(pdfId);
  if (!fs.existsSync(source)) {
    throw new Error(`Source PDF missing: ${source}`);
  }

  const pageCount = await getPdfPageCount(source);
  if (pageCount <= 0) throw new Error('PDF has no pages');

  const outDir = pagesDir(pdfId);
  fs.mkdirSync(outDir, { recursive: true });

  // Clean any pre-existing rendered PNGs (but keep *.text.txt etc).
  for (const entry of fs.readdirSync(outDir)) {
    if (/\.(png|jpg|jpeg)$/i.test(entry)) {
      fs.unlinkSync(path.join(outDir, entry));
    }
  }

  // Run pdftoppm to a temporary prefix so we can safely rename afterwards.
  const prefix = path.join(outDir, 'raw');
  logger.info({ pdfId, pageCount, dpi: config.renderDpi }, 'Rendering PDF pages');
  await runCommand(
    pdftoppmBin(),
    ['-r', String(config.renderDpi), '-png', source, prefix],
    { timeoutMs: 10 * 60 * 1000 }, // 10 minutes hard cap
  );

  // pdftoppm emits `raw-<n>.png` with zero-padding equal to number of digits
  // in pageCount (e.g. "raw-01.png" for 10-99 pages). Enumerate + rename.
  const produced = fs
    .readdirSync(outDir)
    .filter((f) => /^raw-\d+\.png$/i.test(f))
    .map((f) => {
      const m = /^raw-(\d+)\.png$/i.exec(f);
      return { file: f, num: m ? Number(m[1]) : NaN };
    })
    .filter((x) => Number.isFinite(x.num))
    .sort((a, b) => a.num - b.num);

  if (produced.length !== pageCount) {
    throw new Error(
      `pdftoppm produced ${produced.length} pages but pdfinfo reported ${pageCount}`,
    );
  }

  const pagePaths: string[] = [];
  for (const { file, num } of produced) {
    const from = path.join(outDir, file);
    const jpgOut = path.join(outDir, `${formatPageNumber(num, pageCount)}.jpg`);
    await sharp(from)
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(jpgOut);
    await generatePageThumbnail(pdfId, num, pageCount, jpgOut);
    fs.unlinkSync(from);
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
