import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import FormData from 'form-data';
import sharp from 'sharp';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdf_sources WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

async function onePixelPng(rgb: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: rgb } }).png().toBuffer();
}

test('POST /api/pdfs/from-slides creates pages in array order with a reference image on one slide', async () => {
  const app = await buildApp();
  let pdfId = '';
  try {
    const form = new FormData();
    form.append(
      'slides',
      JSON.stringify({
        title: '結構化大綱測試',
        slides: [
          { title: '第一頁', bullets: ['重點A', '重點B'] },
          { title: '第二頁', bullets: ['重點C'], summary: '補充摘要' },
          { title: '第三頁', bullets: [] },
        ],
      }),
    );
    const png = await onePixelPng({ r: 10, g: 200, b: 30 });
    form.append('slide_1_ref_0', png, { filename: 'ref.png', contentType: 'image/png' });

    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/from-slides',
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });
    assert.equal(resp.statusCode, 201);
    const body = resp.json() as { id: string; status: string; page_count: number; title: string };
    pdfId = body.id;
    assert.equal(body.status, 'awaiting_prompt');
    assert.equal(body.page_count, 3);
    assert.equal(body.title, '結構化大綱測試');

    const pages = db
      .prepare(`SELECT page_number, page_uid, text_path, status FROM pages WHERE pdf_id = ? ORDER BY page_number`)
      .all(pdfId) as Array<{ page_number: number; page_uid: string; text_path: string; status: string }>;
    assert.equal(pages.length, 3);
    assert.deepEqual(pages.map((p) => p.page_number), [1, 2, 3]);
    assert.ok(pages.every((p) => p.status === 'pending'));

    const page2Text = fs.readFileSync(path.join(config.storageRoot, pdfId, pages[1]!.text_path), 'utf8');
    assert.match(page2Text, /^Slide 2: 第二頁/);
    assert.match(page2Text, /- 重點C/);
    assert.match(page2Text, /補充摘要/);

    // source.txt must exist — pipeline.ts's isTextImport check gates the whole "reuse existing
    // split pages" branch on it.
    const sourceText = fs.readFileSync(path.join(config.storageRoot, pdfId, 'source.txt'), 'utf8');
    assert.match(sourceText, /Slide 1: 第一頁/);
    assert.match(sourceText, /Slide 3: 第三頁/);

    // figures.json only has an entry for page 2 (the one with a reference image), keyed by the
    // real slide page_number — not an original-PDF page number, since there is no source PDF.
    const manifest = JSON.parse(fs.readFileSync(path.join(config.storageRoot, pdfId, 'figures.json'), 'utf8')) as {
      pages: Array<{ pageNumber: number; figures: Array<{ id: string; imagePath: string; bbox: unknown }> }>;
    };
    assert.equal(manifest.pages.length, 1);
    assert.equal(manifest.pages[0]!.pageNumber, 2);
    assert.equal(manifest.pages[0]!.figures.length, 1);
    const figureImagePath = manifest.pages[0]!.figures[0]!.imagePath;
    assert.ok(fs.existsSync(path.join(config.storageRoot, pdfId, figureImagePath)));

    // split-figure-map.json does identity mapping so pipeline.ts's existing figureMap lookup
    // (`figureMap?.[p.page_number]`) finds it with zero pipeline.ts changes.
    const splitMap = JSON.parse(fs.readFileSync(path.join(config.storageRoot, pdfId, 'split-figure-map.json'), 'utf8'));
    assert.deepEqual(splitMap, { '2': [2] });

    // The pre-existing figures REST route (built for PDF-extracted figures) must already work
    // for these user-uploaded references, unmodified.
    const figuresResp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/2/figures` });
    assert.equal(figuresResp.statusCode, 200);
    const figuresBody = figuresResp.json() as { figures: Array<{ excluded: boolean }> };
    assert.equal(figuresBody.figures.length, 1);
    assert.equal(figuresBody.figures[0]!.excluded, false);

    const page1Figures = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/figures` });
    assert.equal((page1Figures.json() as { figures: unknown[] }).figures.length, 0);
  } finally {
    await app.close();
    if (pdfId) cleanup(pdfId);
  }
});

test('POST /api/pdfs/from-slides rejects more than MAX_REFERENCE_IMAGES_PER_SLIDE images on one slide', async () => {
  const app = await buildApp();
  try {
    const form = new FormData();
    form.append('slides', JSON.stringify({ slides: [{ title: '單頁', bullets: ['x'] }] }));
    const png = await onePixelPng({ r: 1, g: 2, b: 3 });
    form.append('slide_0_ref_0', png, { filename: 'a.png', contentType: 'image/png' });
    form.append('slide_0_ref_1', png, { filename: 'b.png', contentType: 'image/png' });
    form.append('slide_0_ref_2', png, { filename: 'c.png', contentType: 'image/png' });

    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/from-slides',
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });
    assert.equal(resp.statusCode, 400);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'INVALID_REQUEST');
  } finally {
    await app.close();
  }
});

test('POST /api/pdfs/from-slides rejects an empty slides array and missing slides field', async () => {
  const app = await buildApp();
  try {
    const emptyForm = new FormData();
    emptyForm.append('slides', JSON.stringify({ slides: [] }));
    const emptyResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/from-slides',
      headers: emptyForm.getHeaders(),
      payload: emptyForm.getBuffer(),
    });
    assert.equal(emptyResp.statusCode, 400);

    const missingForm = new FormData();
    missingForm.append('title', 'no slides field');
    const missingResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/from-slides',
      headers: missingForm.getHeaders(),
      payload: missingForm.getBuffer(),
    });
    assert.equal(missingResp.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('POST /api/pdfs/from-slides rejects more than MAX_SLIDES entries', async () => {
  const app = await buildApp();
  try {
    const slides = Array.from({ length: 61 }, (_, i) => ({ title: `頁 ${i + 1}`, bullets: ['x'] }));
    const form = new FormData();
    form.append('slides', JSON.stringify({ slides }));
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/from-slides',
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });
    assert.equal(resp.statusCode, 400);
  } finally {
    await app.close();
  }
});
