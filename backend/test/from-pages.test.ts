import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('fp-owner'))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('fp-other'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string; visibility?: string; pageCount?: number } = {}): void {
  const t = nowIso();
  const pageCount = opts.pageCount ?? 2;
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',?,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, pageCount, opts.ownerSub ?? 'fp-owner', opts.visibility ?? 'private', t, t);
  for (let i = 1; i <= pageCount; i++) {
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,status,created_at,updated_at)
       VALUES (?,?,'fp-uid-${i}-${id.slice(-6)}','ready',?,?)`,
    ).run(id, i, t, t);
  }
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

function cleanupByOwner(ownerSub: string): void {
  const rows = db.prepare(`SELECT id FROM pdfs WHERE owner_sub = ?`).all(ownerSub) as { id: string }[];
  for (const row of rows) {
    db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(row.id);
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(row.id);
  }
}

test('POST /api/pdfs/from-pages creates new PDF and returns 201', async () => {
  const srcId = `fp-src-${Date.now()}`;
  seedPdf(srcId, { ownerSub: 'fp-owner', visibility: 'private', pageCount: 3 });
  const app = await buildApp();
  try {
    const body = { title: '複習簡報', pages: [{ pdf_id: srcId, page_number: 1 }, { pdf_id: srcId, page_number: 3 }] };
    const res = await app.inject({ method: 'POST', url: '/api/pdfs/from-pages', headers: { ...OWNER_HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.statusCode, 201, `expected 201 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    const data = JSON.parse(res.body) as { id: string; title: string; pageCount: number };
    assert.equal(typeof data.id, 'string', 'id should be string');
    assert.equal(data.title, '複習簡報');
    assert.equal(data.pageCount, 2);
    // Verify new pages were created in DB
    const newPages = db.prepare(`SELECT * FROM pages WHERE pdf_id = ? ORDER BY page_number`).all(data.id) as { page_number: number }[];
    assert.equal(newPages.length, 2);
    assert.equal(newPages[0]!.page_number, 1);
    assert.equal(newPages[1]!.page_number, 2);
    cleanup(data.id);
  } finally {
    cleanup(srcId);
    await app.close();
  }
});

test('POST /api/pdfs/from-pages returns 401 without auth', async () => {
  const srcId = `fp-noauth-${Date.now()}`;
  seedPdf(srcId, { ownerSub: 'fp-owner', visibility: 'public' });
  const app = await buildApp();
  try {
    const body = { pages: [{ pdf_id: srcId, page_number: 1 }] };
    const res = await app.inject({ method: 'POST', url: '/api/pdfs/from-pages', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.statusCode, 401);
  } finally {
    cleanup(srcId);
    await app.close();
  }
});

test('POST /api/pdfs/from-pages returns 403 for private PDF from other user', async () => {
  const srcId = `fp-priv-${Date.now()}`;
  seedPdf(srcId, { ownerSub: 'fp-owner', visibility: 'private' });
  const app = await buildApp();
  try {
    const body = { pages: [{ pdf_id: srcId, page_number: 1 }] };
    const res = await app.inject({ method: 'POST', url: '/api/pdfs/from-pages', headers: { ...OTHER_HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(srcId);
    cleanupByOwner('fp-other');
    await app.close();
  }
});

test('POST /api/pdfs/from-pages returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const body = { pages: [{ pdf_id: 'nonexistent-fp', page_number: 1 }] };
    const res = await app.inject({ method: 'POST', url: '/api/pdfs/from-pages', headers: { ...OWNER_HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('POST /api/pdfs/from-pages returns 400 for empty pages array', async () => {
  const app = await buildApp();
  try {
    const body = { pages: [] };
    const res = await app.inject({ method: 'POST', url: '/api/pdfs/from-pages', headers: { ...OWNER_HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.statusCode, 400);
  } finally {
    await app.close();
  }
});
