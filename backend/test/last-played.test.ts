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

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('lp-owner'))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('lp-other'))}` };

function seedReadyPdf(id: string, ownerSub: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,'private',?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, ownerSub, t, t);
}

test('PATCH /api/pdfs/:id/last-played — 200 sets last_played_at for owner', async () => {
  const id = `lp-${Date.now()}`;
  seedReadyPdf(id, 'lp-owner');
  const app = await buildApp();
  const resp = await app.inject({ method: 'PATCH', url: `/api/pdfs/${id}/last-played`, headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  const body = resp.json() as { id: string; last_played_at: string };
  assert.equal(body.id, id);
  assert.ok(typeof body.last_played_at === 'string' && body.last_played_at.length > 0);
  await app.close();
});

test('PATCH /api/pdfs/:id/last-played — 403 for non-owner', async () => {
  const id = `lp-403-${Date.now()}`;
  seedReadyPdf(id, 'lp-owner');
  const app = await buildApp();
  const resp = await app.inject({ method: 'PATCH', url: `/api/pdfs/${id}/last-played`, headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('PATCH /api/pdfs/:id/last-played — 404 for unknown pdf', async () => {
  const app = await buildApp();
  const resp = await app.inject({ method: 'PATCH', url: '/api/pdfs/no-such-pdf/last-played', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 404);
  await app.close();
});
