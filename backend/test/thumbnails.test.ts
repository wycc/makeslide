import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  COVER_THUMBNAIL_WIDTH_PX,
  ensureCoverThumbnail,
  ensurePageThumbnail,
  generateCoverThumbnail,
  generatePageThumbnail,
  PAGE_THUMBNAIL_HEIGHT_PX,
  PAGE_THUMBNAIL_WIDTH_PX,
} from '../src/services/thumbnails';
import { coverThumbnailPath, pageThumbnailPath, pdfDir } from '../src/services/storage';

const PDF_ID_PREFIX = 'thumbnails-service-test-20260619';

async function createTempDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), `${PDF_ID_PREFIX}-`));
}

async function writeSourceImage(
  filePath: string,
  options: { width: number; height: number; format: 'png' | 'jpeg' },
): Promise<void> {
  const image = sharp({
    create: {
      width: options.width,
      height: options.height,
      channels: 3,
      background: { r: 48, g: 96, b: 192 },
    },
  });

  if (options.format === 'png') {
    await image.png().toFile(filePath);
    return;
  }

  await image.jpeg({ quality: 90 }).toFile(filePath);
}

async function readDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const metadata = await sharp(filePath).metadata();
  assert.ok(metadata.width, 'thumbnail width should be available');
  assert.ok(metadata.height, 'thumbnail height should be available');
  return { width: metadata.width, height: metadata.height };
}

async function cleanupPdf(pdfId: string): Promise<void> {
  await fs.promises.rm(pdfDir(pdfId), { recursive: true, force: true });
}

test('generatePageThumbnail creates a JPEG within page thumbnail bounds', async (t) => {
  const pdfId = `${PDF_ID_PREFIX}-generate-page`;
  const pageUid = 'page-uid-1';
  const tempDir = await createTempDir();
  t.after(async () => {
    await cleanupPdf(pdfId);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  const sourcePath = path.join(tempDir, 'source.png');
  await writeSourceImage(sourcePath, { width: 1600, height: 1200, format: 'png' });

  const thumbnailPath = await generatePageThumbnail(pdfId, pageUid, sourcePath);
  assert.equal(thumbnailPath, pageThumbnailPath(pdfId, pageUid));
  assert.equal(fs.existsSync(thumbnailPath), true);

  const dimensions = await readDimensions(thumbnailPath);
  assert.equal(dimensions.width <= PAGE_THUMBNAIL_WIDTH_PX, true);
  assert.equal(dimensions.height <= PAGE_THUMBNAIL_HEIGHT_PX, true);
});

test('generateCoverThumbnail creates a JPEG within cover thumbnail bounds', async (t) => {
  const pdfId = `${PDF_ID_PREFIX}-generate-cover`;
  const tempDir = await createTempDir();
  t.after(async () => {
    await cleanupPdf(pdfId);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  const sourcePath = path.join(tempDir, 'source.jpg');
  await writeSourceImage(sourcePath, { width: 960, height: 540, format: 'jpeg' });

  const thumbnailPath = await generateCoverThumbnail(pdfId, sourcePath);
  assert.equal(thumbnailPath, coverThumbnailPath(pdfId));
  assert.equal(fs.existsSync(thumbnailPath), true);

  const dimensions = await readDimensions(thumbnailPath);
  assert.equal(dimensions.width <= COVER_THUMBNAIL_WIDTH_PX, true);
  assert.equal(dimensions.height <= 540, true);
});

test('ensurePageThumbnail returns an existing thumbnail path without regenerating it', async (t) => {
  const pdfId = `${PDF_ID_PREFIX}-ensure-page-existing`;
  const pageUid = 'page-uid-2';
  const tempDir = await createTempDir();
  t.after(async () => {
    await cleanupPdf(pdfId);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  const sourcePath = path.join(tempDir, 'source.png');
  await writeSourceImage(sourcePath, { width: 800, height: 600, format: 'png' });

  const existingThumbnailPath = pageThumbnailPath(pdfId, pageUid);
  await fs.promises.mkdir(path.dirname(existingThumbnailPath), { recursive: true });
  await fs.promises.writeFile(existingThumbnailPath, 'existing-page-thumbnail', 'utf8');
  const before = await fs.promises.stat(existingThumbnailPath);

  const ensuredPath = await ensurePageThumbnail(pdfId, pageUid, sourcePath);
  const after = await fs.promises.stat(existingThumbnailPath);

  assert.equal(ensuredPath, existingThumbnailPath);
  assert.equal(await fs.promises.readFile(existingThumbnailPath, 'utf8'), 'existing-page-thumbnail');
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('ensureCoverThumbnail returns an existing thumbnail path without regenerating it', async (t) => {
  const pdfId = `${PDF_ID_PREFIX}-ensure-cover-existing`;
  const tempDir = await createTempDir();
  t.after(async () => {
    await cleanupPdf(pdfId);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  const sourcePath = path.join(tempDir, 'source.jpg');
  await writeSourceImage(sourcePath, { width: 640, height: 360, format: 'jpeg' });

  const existingThumbnailPath = coverThumbnailPath(pdfId);
  await fs.promises.mkdir(path.dirname(existingThumbnailPath), { recursive: true });
  await fs.promises.writeFile(existingThumbnailPath, 'existing-cover-thumbnail', 'utf8');
  const before = await fs.promises.stat(existingThumbnailPath);

  const ensuredPath = await ensureCoverThumbnail(pdfId, sourcePath);
  const after = await fs.promises.stat(existingThumbnailPath);

  assert.equal(ensuredPath, existingThumbnailPath);
  assert.equal(await fs.promises.readFile(existingThumbnailPath, 'utf8'), 'existing-cover-thumbnail');
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('ensurePageThumbnail and ensureCoverThumbnail return null when the source image is missing', async (t) => {
  const pagePdfId = `${PDF_ID_PREFIX}-missing-page-source`;
  const coverPdfId = `${PDF_ID_PREFIX}-missing-cover-source`;
  t.after(async () => {
    await cleanupPdf(pagePdfId);
    await cleanupPdf(coverPdfId);
  });

  const missingPageSource = path.join(os.tmpdir(), `${PDF_ID_PREFIX}-missing-page-source.png`);
  const missingCoverSource = path.join(os.tmpdir(), `${PDF_ID_PREFIX}-missing-cover-source.jpg`);

  assert.equal(await ensurePageThumbnail(pagePdfId, 'page-uid-3', missingPageSource), null);
  assert.equal(fs.existsSync(pageThumbnailPath(pagePdfId, 'page-uid-3')), false);

  assert.equal(await ensureCoverThumbnail(coverPdfId, missingCoverSource), null);
  assert.equal(fs.existsSync(coverThumbnailPath(coverPdfId)), false);
});
