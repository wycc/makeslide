import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { db } from '../src/db';

setSystemAuthSettings({ googleAuthEnabled: false });

const RUN = crypto.randomBytes(4).toString('hex');
const OWNER_SUB = `similar-owner-${RUN}`;

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(OWNER_SUB))}` };

function seedPdf(id: string, owner: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', 3, ?, ?, ?)`,
  ).run(id, id, `${id}.pdf`, owner, now, now);
}

function seedPage(pdfId: string, pageNumber: number, pageUid: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pages (pdf_id, page_number, page_uid, status, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', ?, ?)`,
  ).run(pdfId, pageNumber, pageUid, now, now);
}

function seedEmbedding(pdfId: string, pageUid: string, vec: number[]): void {
  db.prepare(
    `INSERT OR REPLACE INTO page_embeddings (id, pdf_id, page_uid, content_hash, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(`${pdfId}:${pageUid}`, pdfId, pageUid, 'hash', JSON.stringify(vec), new Date().toISOString());
}

test('GET /api/pdfs/:id/pages/:n/similar — 401 when not authenticated', async () => {
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/whatever/pages/1/similar` });
  assert.equal(resp.statusCode, 401);
  await app.close();
});

test('GET /api/pdfs/:id/pages/:n/similar — ranks owner pages by cosine similarity', async () => {
  const app = await buildApp();
  const pdfA = `sim-a-${RUN}`;
  const pdfB = `sim-b-${RUN}`;
  seedPdf(pdfA, OWNER_SUB);
  seedPdf(pdfB, OWNER_SUB);
  // target on pdfA p1
  seedPage(pdfA, 1, `a1-${RUN}`);
  seedEmbedding(pdfA, `a1-${RUN}`, [1, 0, 0]);
  // very similar page (pdfB p1) and a less similar page (pdfB p2)
  seedPage(pdfB, 1, `b1-${RUN}`);
  seedEmbedding(pdfB, `b1-${RUN}`, [0.9, 0.1, 0]);
  seedPage(pdfB, 2, `b2-${RUN}`);
  seedEmbedding(pdfB, `b2-${RUN}`, [0, 1, 0]); // orthogonal → score 0, filtered out

  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfA}/pages/1/similar`, headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  const body = resp.json() as { similar: Array<{ pdf_id: string; page_number: number; score: number }> };
  // The orthogonal page is filtered (< MIN_SCORE); only the similar one remains.
  assert.equal(body.similar.length, 1);
  assert.equal(body.similar[0]?.pdf_id, pdfB);
  assert.equal(body.similar[0]?.page_number, 1);
  assert.ok(body.similar[0]!.score > 0.9);
  await app.close();
});

test('GET /api/pdfs/:id/pages/:n/similar — 403 for non-owner', async () => {
  const app = await buildApp();
  const pdf = `sim-c-${RUN}`;
  seedPdf(pdf, `another-owner-${RUN}`);
  seedPage(pdf, 1, `c1-${RUN}`);
  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdf}/pages/1/similar`, headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 403);
  await app.close();
});
