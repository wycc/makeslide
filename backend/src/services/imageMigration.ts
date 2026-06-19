import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { db } from '../db';
import { config } from '../config';
import { logger } from '../logger';

async function convertPngToJpgIfNeeded(pngPath: string, jpgPath: string): Promise<boolean> {
  if (!fs.existsSync(pngPath) || fs.existsSync(jpgPath)) return false;
  await sharp(pngPath).jpeg({ quality: 82, mozjpeg: true }).toFile(jpgPath);
  return true;
}

export async function migrateLegacyPngToJpgOnStartup(): Promise<void> {
  const pdfDirs = fs
    .readdirSync(config.storageRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let convertedCover = 0;
  let convertedPages = 0;

  for (const pdfId of pdfDirs) {
    const base = path.join(config.storageRoot, pdfId);
    const coverPng = path.join(base, 'cover.png');
    const coverJpg = path.join(base, 'cover.jpg');
    try {
      if (await convertPngToJpgIfNeeded(coverPng, coverJpg)) convertedCover += 1;
    } catch {
      // ignore per-file errors to avoid blocking startup
    }

    const pagesDir = path.join(base, 'pages');
    if (!fs.existsSync(pagesDir)) continue;
    const pagePngFiles = fs
      .readdirSync(pagesDir)
      .filter((f) => /^\d+\.png$/i.test(f));

    for (const file of pagePngFiles) {
      const pngPath = path.join(pagesDir, file);
      const jpgPath = path.join(pagesDir, file.replace(/\.png$/i, '.jpg'));
      try {
        if (await convertPngToJpgIfNeeded(pngPath, jpgPath)) convertedPages += 1;
      } catch {
        // ignore per-file errors
      }
    }

    db.prepare(
      `UPDATE pages
          SET image_path = REPLACE(image_path, '.png', '.jpg')
        WHERE pdf_id = ? AND image_path LIKE '%.png'`,
    ).run(pdfId);
  }

  if (convertedCover > 0 || convertedPages > 0) {
    logger.info({ convertedCover, convertedPages }, '[image-migration] converted legacy PNG images to JPG');
  }
}
