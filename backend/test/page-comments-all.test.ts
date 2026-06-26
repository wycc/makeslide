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

const PDF_ID = 'cmall-test-1x';

function seedPdf(id: string, opts: { visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM page_comments WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',3,'owner-1',?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.visibility ?? 'private', t, t);
  db.prepare(`INSERT INTO pages (pdf_id,page_number,status,created_at,updated_at) VALUES (?,1,'ready',?,?)`).run(id, t, t);
  db.prepare(`INSERT INTO pages (pdf_id,page_number,status,created_at,updated_at) VALUES (?,2,'ready',?,?)`).run(id, t, t);
  db.prepare(`INSERT INTO pages (pdf_id,page_number,status,created_at,updated_at) VALUES (?,3,'ready',?,?)`).run(id, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM page_comments WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /api/pdfs/:id/comments returns all comments across pages ordered by page_number', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID);
    const t = nowIso();
    db.prepare(`INSERT INTO page_comments (pdf_id,page_number,author,text,resolved,created_at) VALUES (?,3,'a','page 3 comment',0,?)`).run(PDF_ID, t);
    db.prepare(`INSERT INTO page_comments (pdf_id,page_number,author,text,resolved,created_at) VALUES (?,1,'b','page 1 comment',0,?)`).run(PDF_ID, t);
    db.prepare(`INSERT INTO page_comments (pdf_id,page_number,author,text,resolved,created_at) VALUES (?,2,'c','page 2 comment',0,?)`).run(PDF_ID, t);

    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = JSON.parse(resp.body) as { comments: { page_number: number }[] };
    assert.equal(body.comments.length, 3);
    // Should be ordered by page_number ASC
    assert.deepEqual(body.comments.map((c) => c.page_number), [1, 2, 3]);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments returns empty list when no comments', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID);
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = JSON.parse(resp.body) as { comments: unknown[] };
    assert.deepEqual(body.comments, []);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments returns 403 for non-owner on private PDF', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID, { visibility: 'private' });
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments`, headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 403);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments returns 403 without session on private PDF', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID, { visibility: 'private' });
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments` });
    assert.equal(resp.statusCode, 403);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments returns 200 for public PDF without session', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID, { visibility: 'public' });
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/comments` });
    assert.equal(resp.statusCode, 200);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('GET /api/pdfs/:id/comments returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/doesnotexist/comments`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 404);
  } finally {
    await app.close();
  }
});
