import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { buildStepSlideCode, importPptxIntoDeck } from '../src/services/pptx/importPptx';
import { readPageSteps, missingStepLayers } from '../src/services/pageSteps';
import { listPageAssets } from '../src/services/reactSlideAsset';
import { pageImagePath, pageTextPath, pageThumbnailPath, coverImagePath } from '../src/services/storage';
import { recoverOrphanedAddPagesPages } from '../src/worker/addPagesFromPrompt';
import type { FrameRequest } from '../src/services/pptx/renderFrames';

setSystemAuthSettings({ googleAuthEnabled: false });

const here = path.dirname(new URL(import.meta.url).pathname);
const FIXTURE = path.resolve(here, '../../docs/computational Graph.pptx');
const skipFixture = fs.existsSync(FIXTURE) ? false : `fixture missing: ${FIXTURE}`;

/**
 * Stands in for LibreOffice: writes a distinguishable picture per frame, fast. What a real frame
 * looks like is renderFrames.ts's business and is tested there against the real renderer; this
 * test is about what the import *builds* from them.
 */
async function fakeRenderFrames(_pptx: string, requests: FrameRequest[], options: { width: number; height: number; onFrame?: (d: number, t: number) => void }): Promise<void> {
  let done = 0;
  for (const request of requests) {
    const shade = Math.min(255, 40 + request.stepIndex * 20);
    await sharp({
      create: { width: options.width, height: options.height, channels: 3, background: { r: shade, g: shade, b: shade } },
    })
      .jpeg()
      .toFile(request.outPath);
    options.onFrame?.((done += 1), requests.length);
  }
}

function createDeckRow(pdfId: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'processing',0,NULL,'private',?,?)`,
  ).run(pdfId, 'importing', 'deck.pptx', t, t);
  fs.mkdirSync(path.join(config.storageRoot, pdfId, 'pages'), { recursive: true });
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

test('generated step code declares one full-slide layer per step', () => {
  const code = buildStepSlideCode(['asset-a.webp', 'asset-b.webp']);
  assert.match(code, /window\.SlideComponent = Slide;/, 'the React slide contract');
  assert.match(code, /data-ms-step-layer="0"[\s\S]*?asset-a\.webp/);
  assert.match(code, /data-ms-step-layer="1"[\s\S]*?asset-b\.webp/);
  // Assets are referenced by name through MS_ASSET, never by URL: the sandbox has no origin to
  // resolve one against and no session to authenticate it with.
  assert.ok(!/src="api\//.test(code));
  assert.match(code, /MS_ASSET\("asset-a\.webp"\)/);
});

test('importing the real deck builds image pages, stepped React pages and their manifests', { skip: skipFixture, timeout: 300_000 }, async () => {
  const pdfId = 'pptx-import-e2e-01';
  createDeckRow(pdfId);
  try {
    const progress: string[] = [];
    const result = await importPptxIntoDeck({
      pdfId,
      pptxPath: FIXTURE,
      renderFrames: fakeRenderFrames as never,
      onProgress: (p) => progress.push(p.stage),
    });

    assert.equal(result.pageCount, 26);
    assert.equal(result.animatedPageCount, 17, 'the 17 click-built slides became stepped pages');
    assert.equal(result.stepCount, 127, 'every step of every animated slide (136 frames − 9 static)');
    assert.equal(result.title, 'Computational Graph', 'the deck is named after its first slide');
    assert.deepEqual([...new Set(progress)], ['parsing', 'rendering', 'building', 'done']);

    const rows = db
      .prepare(`SELECT page_number, page_uid, image_path, render_type, status FROM pages WHERE pdf_id = ? ORDER BY page_number`)
      .all(pdfId) as Array<{ page_number: number; page_uid: string; image_path: string; render_type: string; status: string }>;
    assert.equal(rows.length, 26);

    // Slide 1 is static: an ordinary image page, with no steps and no React code.
    const first = rows[0]!;
    assert.equal(first.render_type, 'static-image');
    assert.equal(readPageSteps(pdfId, first.page_uid), null);
    assert.ok(fs.existsSync(pageImagePath(pdfId, first.page_uid)), 'it has a picture');
    assert.ok(fs.existsSync(pageThumbnailPath(pdfId, first.page_uid)), 'and a thumbnail');
    assert.match(fs.readFileSync(pageTextPath(pdfId, first.page_uid), 'utf8'), /^Slide 1: Computational Graph/);

    // Slide 3 is built by 8 clicks: a React page with 9 steps.
    const third = rows[2]!;
    assert.equal(third.render_type, 'react');
    const steps = readPageSteps(pdfId, third.page_uid);
    assert.equal(steps?.steps.length, 9, '8 clicks plus the state before the first one');
    assert.equal(steps?.source, 'pptx');
    assert.deepEqual(steps?.steps.map((s) => s.index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(steps?.steps.every((s) => Boolean(s.asset)), true, 'every step has a picture');
    // Narration is a later stage; the import leaves it empty rather than inventing it.
    assert.equal(steps?.steps.every((s) => s.script === ''), true);

    const code = fs.readFileSync(path.join(config.storageRoot, pdfId, 'pages', `${third.page_uid}.slide.jsx`), 'utf8');
    assert.deepEqual(missingStepLayers(code, steps!), [], 'the code draws every step the manifest plays');
    assert.ok(fs.existsSync(path.join(config.storageRoot, pdfId, 'pages', `${third.page_uid}.slide.js`)), 'compiled');
    const assets = listPageAssets(pdfId, third.page_uid);
    assert.equal(assets.length, 9, 'one stored picture per step');
    // The page still has a JPG of the finished slide: thumbnails, export and the sandbox fallback
    // all read it, and none of them know about steps.
    assert.equal(third.image_path, `pages/${third.page_uid}.jpg`);
    assert.ok(fs.existsSync(pageImagePath(pdfId, third.page_uid)));
    assert.ok(fs.existsSync(coverImagePath(pdfId)), 'the deck has a cover');

    // An imported deck is finished before it has any narration, so its pages must already be at
    // the terminal page status. Otherwise the startup sweep that cleans up jobs interrupted by a
    // restart — "a page below terminal in a ready deck is an orphan" — condemns every page of
    // every imported deck the next time the server starts.
    assert.equal(rows.every((row) => row.status === 'audio_ready'), true, 'every page is terminal');
    db.prepare(`UPDATE pdfs SET status = 'ready' WHERE id = ?`).run(pdfId);
    recoverOrphanedAddPagesPages();
    const afterSweep = db
      .prepare(`SELECT status FROM pages WHERE pdf_id = ?`)
      .all(pdfId) as Array<{ status: string }>;
    assert.equal(afterSweep.every((row) => row.status === 'audio_ready'), true, 'the sweep leaves them alone');
  } finally {
    cleanup(pdfId);
  }
});

test('the deck detail serves an imported page as a React page with its steps', { skip: skipFixture, timeout: 300_000 }, async () => {
  const pdfId = 'pptx-import-detail-01';
  createDeckRow(pdfId);
  const app = await buildApp();
  try {
    await importPptxIntoDeck({ pdfId, pptxPath: FIXTURE, renderFrames: fakeRenderFrames as never });
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}` });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { pages: Array<{ page_number: number; render_type: string; steps: unknown[] | null; react_slide_url: string | null }> };
    const page3 = body.pages.find((p) => p.page_number === 3)!;
    assert.equal(page3.render_type, 'react');
    assert.equal(page3.steps?.length, 9);
    assert.ok(page3.react_slide_url, 'the player can fetch the code');
    const page1 = body.pages.find((p) => p.page_number === 1)!;
    assert.equal(page1.steps, null, 'a static slide stays an ordinary page');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('a file that is not a presentation is refused before a deck is created', async () => {
  const app = await buildApp();
  try {
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM pdfs`).get() as { n: number }).n;
    const boundary = '----ms';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.pptx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n\r\n`),
      Buffer.from('not a zip at all'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/from-pptx',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    // 503 when this host has no LibreOffice — also a refusal before anything is created, which is
    // the property under test.
    assert.ok([400, 503].includes(resp.statusCode), `expected a refusal, got ${resp.statusCode}`);
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM pdfs`).get() as { n: number }).n, before, 'no deck row');
  } finally {
    await app.close();
  }
});
