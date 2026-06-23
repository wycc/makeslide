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

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('pc-owner'))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('pc-other'))}` };

function seedReadyPdf(id: string, ownerSub: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,'private',?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, ownerSub, t, t);
}

test('POST /api/pdfs/:id/increment-play-count — 200 increments count for owner', async () => {
  const id = `pc-${Date.now()}`;
  seedReadyPdf(id, 'pc-owner');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/increment-play-count`, headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  const body = resp.json() as { id: string; play_count: number };
  assert.equal(body.id, id);
  assert.equal(body.play_count, 1);
  // second call increments again
  const resp2 = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/increment-play-count`, headers: OWNER_HEADERS });
  assert.equal(resp2.statusCode, 200);
  assert.equal((resp2.json() as { play_count: number }).play_count, 2);
  await app.close();
});

test('POST /api/pdfs/:id/increment-play-count — 403 for non-owner', async () => {
  const id = `pc-403-${Date.now()}`;
  seedReadyPdf(id, 'pc-owner');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/increment-play-count`, headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('POST /api/pdfs/:id/increment-play-count — 404 for unknown pdf', async () => {
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/no-such-pdf/increment-play-count', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 404);
  await app.close();
});
