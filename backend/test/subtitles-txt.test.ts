import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

interface SeedPage { pageUid: string; pageNumber: number; script?: string }

function seedPdf(pdfId: string, opts: { ownerSub?: string | null; visibility?: string; pages?: SeedPage[] } = {}): void {
  const t = nowIso();
  const ownerSub = opts.ownerSub !== undefined ? opts.ownerSub : null;
  const visibility = opts.visibility ?? 'public';
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?)`,
  ).run(pdfId, `Test ${pdfId}`, `${pdfId}.pdf`, opts.pages?.length ?? 0, ownerSub, visibility, t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (const page of opts.pages ?? []) {
    db.prepare(
      `INSERT INTO pages (pdf_id, page_uid, page_number, status, audio_duration_seconds, created_at, updated_at)
       VALUES (?, ?, ?, 'ready', NULL, ?, ?)`,
    ).run(pdfId, page.pageUid, page.pageNumber, t, t);
    if (page.script !== undefined) {
      fs.writeFileSync(path.join(pagesDir, `${page.pageUid}.script.txt`), page.script, 'utf8');
    }
  }
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

test('GET /api/pdfs/:id/subtitles.txt returns a per-page plain-text transcript', async () => {
  const pdfId = 'subtitle-txt-01';
  seedPdf(pdfId, {
    visibility: 'public',
    pages: [
      { pageUid: 'uid-txt-1', pageNumber: 1, script: '第一頁的逐字稿。' },
      { pageUid: 'uid-txt-2', pageNumber: 2, script: '第二頁的逐字稿。' },
    ],
  });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/subtitles.txt` });
    assert.equal(resp.statusCode, 200);
    assert.match(resp.headers['content-type'] as string, /text\/plain/);
    assert.match(resp.headers['content-disposition'] as string, /attachment; filename="transcript\.txt"/);
    assert.equal(resp.body, '# Test subtitle-txt-01\n\n# 第 1 頁\n第一頁的逐字稿。\n\n# 第 2 頁\n第二頁的逐字稿。\n');
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET /api/pdfs/:id/subtitles.txt still emits a heading for pages without a script', async () => {
  const pdfId = 'subtitle-txt-02';
  seedPdf(pdfId, {
    visibility: 'public',
    pages: [
      { pageUid: 'uid-txt-3', pageNumber: 1, script: '有稿。' },
      { pageUid: 'uid-txt-4', pageNumber: 2 },
    ],
  });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/subtitles.txt` });
    assert.equal(resp.statusCode, 200);
    assert.equal(resp.body, '# Test subtitle-txt-02\n\n# 第 1 頁\n有稿。\n\n# 第 2 頁\n');
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET /api/pdfs/:id/subtitles.txt returns 403 for a non-owner on a private PDF', async () => {
  const pdfId = 'subtitle-txt-03';
  seedPdf(pdfId, { ownerSub: 'owner-x', visibility: 'private', pages: [{ pageUid: 'uid-txt-5', pageNumber: 1, script: 'x' }] });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/subtitles.txt`, headers: { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('someone-else'))}` } });
    assert.equal(resp.statusCode, 403);
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET /api/pdfs/:id/subtitles.txt omits the title line when the title is blank', async () => {
  const pdfId = 'subtitle-txt-04';
  seedPdf(pdfId, { visibility: 'public', pages: [{ pageUid: 'uid-txt-6', pageNumber: 1, script: '只有頁。' }] });
  db.prepare(`UPDATE pdfs SET title = '' WHERE id = ?`).run(pdfId);
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/subtitles.txt` });
    assert.equal(resp.statusCode, 200);
    assert.equal(resp.body, '# 第 1 頁\n只有頁。\n');
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET /api/pdfs/:id/subtitles.txt returns 404 for an unknown PDF', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/nope-txt-xx/subtitles.txt` });
    assert.equal(resp.statusCode, 404);
  } finally {
    await app.close();
  }
});
