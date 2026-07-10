import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('rev-owner'))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('rev-other'))}` };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(id: string, visibility: 'private' | 'public', updatedAt: string): void {
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', 3, 'rev-owner', ?, ?, ?)`,
  ).run(id, id, `${id}.pdf`, visibility, nowIso(), updatedAt);
}

test('GET /revision returns the deck updated_at/page_count for a reader', async () => {
  seedPdf('rev-read-01', 'private', '2026-07-10T00:00:00.000Z');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: '/api/pdfs/rev-read-01/revision', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  const body = resp.json() as { updated_at: string; page_count: number; status: string };
  assert.equal(body.updated_at, '2026-07-10T00:00:00.000Z');
  assert.equal(body.page_count, 3);
  assert.equal(body.status, 'ready');
  await app.close();
});

test('GET /revision reflects a bumped updated_at after a content change', async () => {
  seedPdf('rev-bump-01', 'private', '2026-07-10T00:00:00.000Z');
  const app = await buildApp();
  const before = (await app.inject({ method: 'GET', url: '/api/pdfs/rev-bump-01/revision', headers: OWNER_HEADERS })).json() as { updated_at: string };
  db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run('2026-07-10T01:00:00.000Z', 'rev-bump-01');
  const after = (await app.inject({ method: 'GET', url: '/api/pdfs/rev-bump-01/revision', headers: OWNER_HEADERS })).json() as { updated_at: string };
  assert.notEqual(after.updated_at, before.updated_at);
  assert.equal(after.updated_at, '2026-07-10T01:00:00.000Z');
  await app.close();
});

test('GET /revision denies a non-owner on a private presentation and 404s the unknown', async () => {
  seedPdf('rev-private-01', 'private', nowIso());
  const app = await buildApp();
  const forbidden = await app.inject({ method: 'GET', url: '/api/pdfs/rev-private-01/revision', headers: OTHER_HEADERS });
  assert.equal(forbidden.statusCode, 403);
  const missing = await app.inject({ method: 'GET', url: '/api/pdfs/rev-missing-01/revision', headers: OWNER_HEADERS });
  assert.equal(missing.statusCode, 404);
  await app.close();
});
