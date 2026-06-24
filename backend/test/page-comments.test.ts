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

function seedPdf(id: string, opts: { ownerSub?: string | null; visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM page_comments WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',3,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? 'owner-1', opts.visibility ?? 'private', t, t);
  db.prepare(`INSERT INTO pages (pdf_id,page_number,status,created_at,updated_at) VALUES (?,1,'ready',?,?)`).run(id, t, t);
  db.prepare(`INSERT INTO pages (pdf_id,page_number,status,created_at,updated_at) VALUES (?,2,'ready',?,?)`).run(id, t, t);
  db.prepare(`INSERT INTO pages (pdf_id,page_number,status,created_at,updated_at) VALUES (?,3,'ready',?,?)`).run(id, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM page_comments WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

const PDF_ID = 'cmtest-01-xx';
const PDF_PUBLIC = 'cmtest-02-xx';
const PDF_EDITABLE = 'cmtest-03-xx';

test('page-comments: GET returns empty list for a page with no comments', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID);
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/pages/1/comments`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = JSON.parse(resp.body) as { comments: unknown[] };
    assert.deepEqual(body.comments, []);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('page-comments: POST creates a comment and GET returns it', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID);
    const postResp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/comments`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      payload: JSON.stringify({ author: '小明', text: '這頁說得很好！' }),
    });
    assert.equal(postResp.statusCode, 201);
    const created = (JSON.parse(postResp.body) as { comment: { id: number; author: string; text: string; resolved: boolean } }).comment;
    assert.equal(created.author, '小明');
    assert.equal(created.text, '這頁說得很好！');
    assert.equal(created.resolved, false);

    const getResp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/pages/1/comments`, headers: OWNER_HEADERS });
    assert.equal(getResp.statusCode, 200);
    const list = (JSON.parse(getResp.body) as { comments: unknown[] }).comments;
    assert.equal(list.length, 1);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('page-comments: PATCH resolves a comment', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID);
    const postResp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/2/comments`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      payload: JSON.stringify({ author: 'teacher', text: '需要修改這頁' }),
    });
    assert.equal(postResp.statusCode, 201);
    const commentId = (JSON.parse(postResp.body) as { comment: { id: number } }).comment.id;

    const patchResp = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${PDF_ID}/comments/${commentId}`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      payload: JSON.stringify({ resolved: true }),
    });
    assert.equal(patchResp.statusCode, 200);
    const updated = (JSON.parse(patchResp.body) as { comment: { resolved: boolean } }).comment;
    assert.equal(updated.resolved, true);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('page-comments: DELETE removes a comment', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID);
    const postResp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/3/comments`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      payload: JSON.stringify({ author: 'anon', text: '要刪掉的評論' }),
    });
    const commentId = (JSON.parse(postResp.body) as { comment: { id: number } }).comment.id;

    const delResp = await app.inject({
      method: 'DELETE',
      url: `/api/pdfs/${PDF_ID}/comments/${commentId}`,
      headers: OWNER_HEADERS,
    });
    assert.equal(delResp.statusCode, 204);

    const getResp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/pages/3/comments`, headers: OWNER_HEADERS });
    const list = (JSON.parse(getResp.body) as { comments: unknown[] }).comments;
    assert.equal(list.length, 0);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('page-comments: GET on public PDF succeeds without session', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_PUBLIC, { ownerSub: 'owner-1', visibility: 'public' });
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_PUBLIC}/pages/1/comments` });
    assert.equal(resp.statusCode, 200);
  } finally {
    cleanup(PDF_PUBLIC);
    await app.close();
  }
});

test('page-comments: GET on private PDF returns 403 for other user', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID, { ownerSub: 'owner-1', visibility: 'private' });
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/pages/1/comments`, headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 403);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('page-comments: PATCH returns 403 for non-owner on private PDF', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID, { ownerSub: 'owner-1', visibility: 'private' });
    const postResp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/comments`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      payload: JSON.stringify({ text: 'some comment' }),
    });
    const commentId = (JSON.parse(postResp.body) as { comment: { id: number } }).comment.id;

    const patchResp = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${PDF_ID}/comments/${commentId}`,
      headers: { ...OTHER_HEADERS, 'content-type': 'application/json' },
      payload: JSON.stringify({ resolved: true }),
    });
    assert.equal(patchResp.statusCode, 403);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});

test('page-comments: GET returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/doesnotexist/pages/1/comments`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('page-comments: PATCH returns 404 for unknown comment', async () => {
  const app = await buildApp();
  try {
    seedPdf(PDF_ID, { ownerSub: 'owner-1', visibility: 'private' });
    const patchResp = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${PDF_ID}/comments/99999`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      payload: JSON.stringify({ resolved: true }),
    });
    assert.equal(patchResp.statusCode, 404);
  } finally {
    cleanup(PDF_ID);
    await app.close();
  }
});
