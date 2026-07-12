import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
const JSZip = require('jszip') as { loadAsync: (data: Buffer) => Promise<any> };

/** Concatenated text of every notes slide in the generated PPTX. */
async function pptxNotesText(pptxBuf: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const zip = await JSZip.loadAsync(pptxBuf);
  const chunks: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  for (const name of Object.keys(zip.files as Record<string, unknown>)) {
    if (!/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)) continue;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    chunks.push((await zip.files[name].async('string')) as string);
  }
  return chunks.join('\n');
}

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(
  pdfId: string,
  opts: { ownerSub?: string | null; visibility?: string; pageCount?: number } = {},
): void {
  const t = nowIso();
  const ownerSub = opts.ownerSub !== undefined ? opts.ownerSub : null;
  const visibility = opts.visibility ?? 'public';
  const pageCount = opts.pageCount ?? 1;

  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?)`,
  ).run(pdfId, `Test PDF ${pdfId}`, `${pdfId}.pdf`, pageCount, ownerSub, visibility, t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });

  for (let i = 1; i <= pageCount; i++) {
    const uid = `${pdfId}-p${i}`;
    // minimal valid 1×1 white PNG (RGBA, generated via canvas)
    const minimalPng = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '00000006624b474400ff00ff00ffa0bda793' +
      '0000000d49444154089963f8ffffff7f0009fb03fd08d1e81e' +
      '0000000049454e44ae426082',
      'hex',
    );
    const imgPath = path.join(pagesDir, `${uid}.png`);
    fs.writeFileSync(imgPath, minimalPng);

    db.prepare(
      `INSERT INTO pages (pdf_id, page_uid, page_number, image_path, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ready', ?, ?)`,
    ).run(pdfId, uid, i, `pages/${uid}.png`, t, t);
  }
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

test('GET /api/pdfs/:id/slides.pptx returns 200 with correct content-type', async () => {
  const id = `pptx-test-${Date.now()}`;
  seedPdf(id, { pageCount: 2 });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/slides.pptx` });
    assert.equal(res.statusCode, 200);
    assert.ok(
      res.headers['content-type']?.toString().includes(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
      `unexpected content-type: ${String(res.headers['content-type'])}`,
    );
    assert.ok(res.rawPayload.length > 1000, 'payload too small to be a valid PPTX');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('slides.pptx embeds the page script as speaker notes when script_path is recorded on the row', async () => {
  const id = `pptx-notes-db-${Date.now()}`;
  seedPdf(id, { pageCount: 1 });
  const uid = `${id}-p1`;
  const pagesDir = path.join(config.storageRoot, id, 'pages');
  fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), '第一頁的逐字稿內容（DB 路徑）');
  db.prepare(`UPDATE pages SET script_path = ? WHERE pdf_id = ? AND page_number = 1`).run(
    `pages/${uid}.script.txt`,
    id,
  );
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/slides.pptx` });
    assert.equal(res.statusCode, 200);
    const notes = await pptxNotesText(res.rawPayload);
    assert.ok(notes.includes('第一頁的逐字稿內容（DB 路徑）'), `speaker notes missing script text: ${notes.slice(0, 500)}`);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('slides.pptx falls back to the conventional script file location when script_path is NULL', async () => {
  const id = `pptx-notes-fb-${Date.now()}`;
  seedPdf(id, { pageCount: 1 });
  const uid = `${id}-p1`;
  const pagesDir = path.join(config.storageRoot, id, 'pages');
  // Script exists on disk at the conventional <page_uid>.script.txt location, but the
  // page row never recorded script_path (same situation scorm.ts/h5p.ts already handle).
  fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), '第一頁的逐字稿內容（慣例路徑）');
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/slides.pptx` });
    assert.equal(res.statusCode, 200);
    const notes = await pptxNotesText(res.rawPayload);
    assert.ok(notes.includes('第一頁的逐字稿內容（慣例路徑）'), `speaker notes missing fallback script text: ${notes.slice(0, 500)}`);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/slides.pptx returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/pdfs/nonexistent-pptx-id/slides.pptx' });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/slides.pptx returns 403 for private PDF without session', async () => {
  const id = `pptx-private-${Date.now()}`;
  seedPdf(id, { ownerSub: 'private-owner', visibility: 'private', pageCount: 1 });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/slides.pptx` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/slides.pptx returns 400 when no pages with images', async () => {
  const id = `pptx-nopages-${Date.now()}`;
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', 0, null, 'public', ?, ?)`,
  ).run(id, 'Empty', 'empty.pdf', t, t);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/slides.pptx` });
    assert.equal(res.statusCode, 400);
  } finally {
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
    await app.close();
  }
});
