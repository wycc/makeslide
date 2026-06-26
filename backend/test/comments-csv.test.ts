import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'owner-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-1'))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('other-user'))}` };

function nowIso() { return new Date().toISOString(); }

const PDF_ID = 'cmcsv-test-1x';

function seedPdf(id: string, opts: { visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM page_comments WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',3,'owner-1',?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.visibility ?? 'private', t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM page_comments WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /api/pdfs/:id/comments.csv returns CSV with header and rows ordered by page', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID);
    db.prepare(`INSERT INTO page_comments (pdf_id,page_number,author,text,resolved,created_at) VALUES (?,2,'bob','second',1,'2026-06-26T01:00:00.000Z')`).run(PDF_ID);
    db.prepare(`INSERT INTO page_comments (pdf_id,page_number,author,text,resolved,created_at) VALUES (?,1,'alice','first',0,'2026-06-26T00:00:00.000Z')`).run(PDF_ID);

    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments.csv`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    assert.match(resp.headers['content-type'] as string, /text\/csv/);
    assert.match(resp.headers['content-disposition'] as string, /attachment; filename="PDF cmcsv-test-1x-comments\.csv"/);

    const lines = resp.body.trim().split('\n');
    assert.equal(lines[0], 'page,author,text,resolved,created_at');
    // ordered by page_number ASC
    assert.equal(lines[1], '1,alice,first,false,2026-06-26T00:00:00.000Z');
    assert.equal(lines[2], '2,bob,second,true,2026-06-26T01:00:00.000Z');
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments.csv escapes commas, quotes and defangs formula injection', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID);
    db.prepare(`INSERT INTO page_comments (pdf_id,page_number,author,text,resolved,created_at) VALUES (?,1,'eve','=SUM(A1:A2), "quoted"',0,'2026-06-26T00:00:00.000Z')`).run(PDF_ID);

    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments.csv`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const lines = resp.body.trim().split('\n');
    // formula lead char defanged with leading quote, and field quoted because of comma/quote
    assert.equal(lines[1], `1,eve,"'=SUM(A1:A2), ""quoted""",false,2026-06-26T00:00:00.000Z`);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments.csv returns only the header when there are no comments', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID);
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments.csv`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    assert.equal(resp.body, '﻿page,author,text,resolved,created_at\n');
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments.csv returns 403 for non-owner on private PDF', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID, { visibility: 'private' });
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments.csv`, headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 403);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments.csv returns 403 for non-owner on public (read-only) PDF', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID, { visibility: 'public' });
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments.csv`, headers: OTHER_HEADERS });
    // public is readable but CSV export requires edit permission
    assert.equal(resp.statusCode, 403);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments.csv allows non-owner on public_editable PDF', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID, { visibility: 'public_editable' });
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments.csv`, headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 200);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments.csv returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/nonexistent-xx/comments.csv`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments.csv falls back to an id-based filename when the title is blank', async () => {
  seedPdf(PDF_ID);
  db.prepare(`UPDATE pdfs SET title = '' WHERE id = ?`).run(PDF_ID);
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments.csv`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    assert.match(resp.headers['content-disposition'] as string, /attachment; filename="comments-cmcsv-test-1x\.csv"/);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});
