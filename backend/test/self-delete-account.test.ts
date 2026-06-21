import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { db } from '../src/db';
import { setSystemAuthSettings } from '../src/services/aiSettings';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const ADMIN = 'self-delete-account-admin';
const SELF = 'self-delete-account-self';
const SELF_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(SELF))}` };
const ADMIN_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(ADMIN))}` };

function seedPdf(id: string, ownerSub: string): void {
  const now = new Date().toISOString();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, id, `${id}.pdf`, 'completed', 1, ownerSub, 'private', now, now);
  const dir = path.join(config.storageRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'marker.txt'), id);
}

function seedAccountDir(accountId: string): string {
  const dir = path.join(config.repoRoot, 'accounts', accountId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.env'), 'OPENAI_API_KEY=sk-test\n');
  return dir;
}

function cleanup(...accountIds: string[]): void {
  for (const id of ['self-delete-account-pdf-1', 'self-delete-account-pdf-2', 'self-delete-account-other-pdf']) {
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
    fs.rmSync(path.join(config.storageRoot, id), { recursive: true, force: true });
  }
  for (const accountId of accountIds) {
    fs.rmSync(path.join(config.repoRoot, 'accounts', accountId), { recursive: true, force: true });
  }
}

test('DELETE /api/system/account rejects a request with no session (falls back to the default account)', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN] });
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'DELETE',
      url: '/api/system/account',
      headers: { 'content-type': 'application/json' },
      payload: { confirm: true },
    });
    assert.equal(resp.statusCode, 400);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'DANGEROUS_ACCOUNT');
  } finally {
    await app.close();
  }
});

test('DELETE /api/system/account rejects an admin account', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN] });
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'DELETE',
      url: '/api/system/account',
      headers: { ...ADMIN_HEADERS, 'content-type': 'application/json' },
      payload: { confirm: true },
    });
    assert.equal(resp.statusCode, 400);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'DANGEROUS_ACCOUNT');
  } finally {
    await app.close();
  }
});

test('DELETE /api/system/account rejects a missing or false confirm field', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN] });
  const app = await buildApp();
  try {
    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/system/account',
      headers: { ...SELF_HEADERS, 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(missing.statusCode, 400);
    assert.equal((missing.json() as { error: { code: string } }).error.code, 'INVALID_REQUEST');

    const false_ = await app.inject({
      method: 'DELETE',
      url: '/api/system/account',
      headers: { ...SELF_HEADERS, 'content-type': 'application/json' },
      payload: { confirm: false },
    });
    assert.equal(false_.statusCode, 400);
    assert.equal((false_.json() as { error: { code: string } }).error.code, 'INVALID_REQUEST');
  } finally {
    await app.close();
  }
});

test('DELETE /api/system/account deletes the caller\'s own PDFs and account settings, leaves others untouched, and clears the session cookie', async () => {
  cleanup(SELF);
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN] });
  seedPdf('self-delete-account-pdf-1', SELF);
  seedPdf('self-delete-account-pdf-2', SELF);
  seedPdf('self-delete-account-other-pdf', 'someone-else');
  const accountDir = seedAccountDir(SELF);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'DELETE',
      url: '/api/system/account',
      headers: { ...SELF_HEADERS, 'content-type': 'application/json' },
      payload: { confirm: true },
    });
    assert.equal(resp.statusCode, 200, resp.body);
    const body = resp.json() as { ok: boolean; account_id: string; deleted_pdf_count: number; deleted_pdfs: string[]; account_deleted: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.account_id, SELF);
    assert.equal(body.deleted_pdf_count, 2);
    assert.deepEqual(body.deleted_pdfs.sort(), ['self-delete-account-pdf-1', 'self-delete-account-pdf-2']);
    assert.equal(body.account_deleted, true);

    const remaining = db.prepare(`SELECT COUNT(*) AS count FROM pdfs WHERE owner_sub = ?`).get(SELF) as { count: number };
    assert.equal(remaining.count, 0);
    assert.equal(Boolean(db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get('self-delete-account-other-pdf')), true);
    assert.equal(fs.existsSync(path.join(config.storageRoot, 'self-delete-account-pdf-1')), false);
    assert.equal(fs.existsSync(path.join(config.storageRoot, 'self-delete-account-pdf-2')), false);
    assert.equal(fs.existsSync(path.join(config.storageRoot, 'self-delete-account-other-pdf')), true);
    assert.equal(fs.existsSync(accountDir), false);

    const cookie = resp.headers['set-cookie'];
    const header = Array.isArray(cookie) ? cookie[0] : cookie;
    assert.ok(header?.startsWith('makeslide_session=;'), `expected cleared session cookie in: ${header}`);
    assert.ok(header?.includes('Max-Age=0'));
  } finally {
    await app.close();
    cleanup(SELF);
  }
});
