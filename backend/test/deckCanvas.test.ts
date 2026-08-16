import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { db } from '../src/db';
import { config } from '../src/config';
import { clearDeckCanvasCacheForTest, deckCanvasSize } from '../src/services/deckCanvas';

/**
 * The canvas a React page lays out against comes from the deck, not a constant — see
 * services/deckCanvas.ts for why (a 16:9 React page inside a 3:2 deck is visibly a different size
 * from every page around it, and baking makes that permanent).
 */

const RUN = crypto.randomBytes(4).toString('hex');

async function seedDeck(pdfId: string, sizes: Array<[number, number] | null>): Promise<void> {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',?,?,'private',?,?)`,
  ).run(pdfId, 'D', 'd.pdf', sizes.length, `owner-${RUN}`, t, t);
  const dir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(dir, { recursive: true });
  for (const [idx, size] of sizes.entries()) {
    const uid = `dc${RUN}-${idx}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,status,created_at,updated_at)
       VALUES (?,?,?,'audio_ready',?,?)`,
    ).run(pdfId, idx + 1, uid, t, t);
    if (!size) continue;
    await sharp({ create: { width: size[0], height: size[1], channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg().toFile(path.join(dir, `${uid}.jpg`));
  }
  clearDeckCanvasCacheForTest();
}

test('the canvas is the size most of the deck already is', async (t) => {
  const pdfId = `dc-mode-${RUN}`;
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));
  // Exactly the reported deck: six 3:2 image pages and one 16:9 page left behind by a bake.
  await seedDeck(pdfId, [[1536, 1024], [1536, 1024], [1536, 1024], [1536, 1024], [1920, 1080], [1536, 1024], [1536, 1024]]);
  assert.deepEqual(await deckCanvasSize(pdfId), { width: 1536, height: 1024 });
});

test('a deck with no readable page image falls back to 1920x1080', async (t) => {
  const pdfId = `dc-empty-${RUN}`;
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));
  await seedDeck(pdfId, [null, null]);
  assert.deepEqual(await deckCanvasSize(pdfId), { width: 1920, height: 1080 });
});

test('implausible page images do not get to define the canvas', async (t) => {
  const pdfId = `dc-bounds-${RUN}`;
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));
  // A tiny placeholder outnumbers the real slides; it is still not a canvas.
  await seedDeck(pdfId, [[16, 16], [16, 16], [16, 16], [1600, 900]]);
  assert.deepEqual(await deckCanvasSize(pdfId), { width: 1600, height: 900 });
});

test('an evenly split deck keeps the larger canvas rather than picking by page order', async (t) => {
  const pdfId = `dc-tie-${RUN}`;
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));
  await seedDeck(pdfId, [[1280, 720], [1920, 1080]]);
  assert.deepEqual(await deckCanvasSize(pdfId), { width: 1920, height: 1080 });
});

test('the result is cached, since the editor asks on every page load', async (t) => {
  const pdfId = `dc-cache-${RUN}`;
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));
  await seedDeck(pdfId, [[1536, 1024]]);
  assert.deepEqual(await deckCanvasSize(pdfId), { width: 1536, height: 1024 });
  // Delete the images: a cached answer must not go back to disk.
  fs.rmSync(path.join(config.storageRoot, pdfId, 'pages'), { recursive: true, force: true });
  assert.deepEqual(await deckCanvasSize(pdfId), { width: 1536, height: 1024 });
  clearDeckCanvasCacheForTest();
  assert.deepEqual(await deckCanvasSize(pdfId), { width: 1920, height: 1080 });
});
