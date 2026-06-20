import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { convertPngToJpgIfNeeded, migrateLegacyPngToJpgOnStartup } from '../src/services/imageMigration';
import { config } from '../src/config';
import { db } from '../src/db';

const PDF_ID_PREFIX = 'image-migration-test-20260620';

async function createTempDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), `${PDF_ID_PREFIX}-`));
}

async function writePng(filePath: string): Promise<void> {
  await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toFile(filePath);
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- convertPngToJpgIfNeeded (unit) ---

test('convertPngToJpgIfNeeded converts a real PNG to a valid JPEG and returns true', async (t) => {
  const dir = await createTempDir();
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const pngPath = path.join(dir, 'cover.png');
  const jpgPath = path.join(dir, 'cover.jpg');
  await writePng(pngPath);

  const converted = await convertPngToJpgIfNeeded(pngPath, jpgPath);
  assert.equal(converted, true);
  assert.ok(fs.existsSync(jpgPath));
  const metadata = await sharp(jpgPath).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 4);
  assert.equal(metadata.height, 4);
});

test('convertPngToJpgIfNeeded returns false when the source PNG does not exist', async (t) => {
  const dir = await createTempDir();
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const converted = await convertPngToJpgIfNeeded(path.join(dir, 'missing.png'), path.join(dir, 'missing.jpg'));
  assert.equal(converted, false);
});

test('convertPngToJpgIfNeeded returns false and does not touch an existing JPEG', async (t) => {
  const dir = await createTempDir();
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const pngPath = path.join(dir, 'cover.png');
  const jpgPath = path.join(dir, 'cover.jpg');
  await writePng(pngPath);
  await fs.promises.writeFile(jpgPath, 'already-converted-placeholder', 'utf8');

  const converted = await convertPngToJpgIfNeeded(pngPath, jpgPath);
  assert.equal(converted, false);
  // The pre-existing "jpg" content should be left untouched, not overwritten by a real conversion.
  assert.equal(await fs.promises.readFile(jpgPath, 'utf8'), 'already-converted-placeholder');
});

// --- migrateLegacyPngToJpgOnStartup (integration, uses the shared storageRoot like other tests) ---

test('migrateLegacyPngToJpgOnStartup converts legacy cover/page PNGs and updates image_path in the DB', async (t) => {
  const pdfId = `${PDF_ID_PREFIX}-startup-01`;
  const base = path.join(config.storageRoot, pdfId);
  const pagesDir = path.join(base, 'pages');
  await fs.promises.mkdir(pagesDir, { recursive: true });
  t.after(async () => {
    await fs.promises.rm(base, { recursive: true, force: true });
    db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  });

  await writePng(path.join(base, 'cover.png'));
  await writePng(path.join(pagesDir, '001.png'));

  const t1 = nowIso();
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,NULL,'private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, t1, t1);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,NULL,NULL,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, 'pages/001.png', t1, t1);

  await migrateLegacyPngToJpgOnStartup();

  assert.ok(fs.existsSync(path.join(base, 'cover.jpg')), 'cover.jpg should have been created');
  assert.ok(fs.existsSync(path.join(pagesDir, '001.jpg')), 'pages/001.jpg should have been created');
  const row = db.prepare(`SELECT image_path FROM pages WHERE pdf_id = ? AND page_number = 1`).get(pdfId) as { image_path: string };
  assert.equal(row.image_path, 'pages/001.jpg');
});

test('migrateLegacyPngToJpgOnStartup skips a corrupt PNG without throwing or blocking other directories', async (t) => {
  const pdfId = `${PDF_ID_PREFIX}-corrupt-01`;
  const base = path.join(config.storageRoot, pdfId);
  await fs.promises.mkdir(base, { recursive: true });
  t.after(async () => {
    await fs.promises.rm(base, { recursive: true, force: true });
  });

  // Not a real PNG — sharp() should reject this, and the per-file try/catch should swallow it.
  await fs.promises.writeFile(path.join(base, 'cover.png'), 'not a real png', 'utf8');

  await assert.doesNotReject(() => migrateLegacyPngToJpgOnStartup());
  assert.equal(fs.existsSync(path.join(base, 'cover.jpg')), false);
});
