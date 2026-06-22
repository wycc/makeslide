import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

const ADMIN_SUB = 'admin-thumb-cache';
const NON_ADMIN_SUB = 'user-thumb-cache';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const ADMIN_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(ADMIN_SUB))}` };
const USER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(NON_ADMIN_SUB))}` };

test('DELETE /api/system/thumbnail-cache — 200 for admin', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN_SUB] });
  const app = await buildApp();
  const resp = await app.inject({ method: 'DELETE', url: '/api/system/thumbnail-cache', headers: ADMIN_HEADERS });
  assert.equal(resp.statusCode, 200);
  const body = resp.json() as { ok: boolean; files_deleted: number; bytes_freed: number };
  assert.equal(body.ok, true);
  assert.equal(typeof body.files_deleted, 'number');
  assert.equal(typeof body.bytes_freed, 'number');
  await app.close();
});

test('DELETE /api/system/thumbnail-cache — 403 for non-admin', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN_SUB] });
  const app = await buildApp();
  const resp = await app.inject({ method: 'DELETE', url: '/api/system/thumbnail-cache', headers: USER_HEADERS });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('DELETE /api/admin/cache — 200 for admin', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN_SUB] });
  const app = await buildApp();
  const resp = await app.inject({ method: 'DELETE', url: '/api/admin/cache', headers: ADMIN_HEADERS });
  assert.equal(resp.statusCode, 200);
  const body = resp.json() as { ok: boolean; dirs_cleared: number; bytes_freed: number };
  assert.equal(body.ok, true);
  assert.equal(typeof body.dirs_cleared, 'number');
  assert.equal(typeof body.bytes_freed, 'number');
  await app.close();
});

test('DELETE /api/admin/cache — 403 for non-admin', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN_SUB] });
  const app = await buildApp();
  const resp = await app.inject({ method: 'DELETE', url: '/api/admin/cache', headers: USER_HEADERS });
  assert.equal(resp.statusCode, 403);
  await app.close();
});
