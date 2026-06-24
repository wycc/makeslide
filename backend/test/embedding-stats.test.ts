import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { db } from '../src/db';

setSystemAuthSettings({ googleAuthEnabled: false });

// Unique per run: the shared app.db persists across runs, so fixed ids would
// collide on the pdfs primary key and pollute the owner's embedding counts.
const RUN = crypto.randomBytes(4).toString('hex');
const OWNER_SUB = `embed-stats-owner-${RUN}`;

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(OWNER_SUB))}` };

function seedPdf(id: string, owner: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, owner_sub, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', ?, ?, ?)`,
  ).run(id, id, `${id}.pdf`, owner, now, now);
}

function seedEmbedding(pdfId: string, pageUid: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO page_embeddings (id, pdf_id, page_uid, content_hash, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(`${pdfId}:${pageUid}`, pdfId, pageUid, 'hash', '[0.1,0.2]', new Date().toISOString());
}

test('GET /api/me/embedding-stats — 401 when not authenticated', async () => {
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: '/api/me/embedding-stats' });
  assert.equal(resp.statusCode, 401);
  await app.close();
});

test('GET /api/me/embedding-stats — counts indexed pages across owned PDFs', async () => {
  const app = await buildApp();
  const pdf1 = `embed-pdf-1-${RUN}`;
  const pdf2 = `embed-pdf-2-${RUN}`;
  const pdfOther = `embed-pdf-other-${RUN}`;
  seedPdf(pdf1, OWNER_SUB);
  seedPdf(pdf2, OWNER_SUB);
  seedPdf(pdfOther, `someone-else-${RUN}`);
  seedEmbedding(pdf1, 'p1');
  seedEmbedding(pdf1, 'p2');
  seedEmbedding(pdf2, 'p1');
  seedEmbedding(pdfOther, 'p1'); // not owned — must be excluded

  const resp = await app.inject({ method: 'GET', url: '/api/me/embedding-stats', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  const body = resp.json() as { indexed_pages: number; indexed_pdfs: number };
  assert.equal(body.indexed_pages, 3);
  assert.equal(body.indexed_pdfs, 2);
  await app.close();
});
