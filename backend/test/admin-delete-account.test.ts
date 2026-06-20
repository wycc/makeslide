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

const ADMIN = 'admin-delete-account-admin';
const TARGET = 'admin-delete-account-target';
const OTHER_ADMIN = 'admin-delete-account-other-admin';
const ADMIN_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(ADMIN))}` };
const NON_ADMIN_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('admin-delete-account-non-admin'))}` };

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
  for (const id of ['admin-delete-account-pdf-1', 'admin-delete-account-pdf-2', 'admin-delete-account-other-pdf']) {
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
    fs.rmSync(path.join(config.storageRoot, id), { recursive: true, force: true });
  }
  for (const accountId of accountIds) {
    fs.rmSync(path.join(config.repoRoot, 'accounts', accountId), { recursive: true, force: true });
  }
}

test('DELETE /api/system/accounts/:account_id rejects non-admin users', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN] });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'DELETE', url: `/api/system/accounts/${TARGET}`, headers: NON_ADMIN_HEADERS });
    assert.equal(resp.statusCode, 403);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'ADMIN_REQUIRED');
  } finally {
    await app.close();
  }
});

test('DELETE /api/system/accounts/:account_id deletes target account PDFs, storage directories, and account settings', async () => {
  cleanup(TARGET);
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN] });
  seedPdf('admin-delete-account-pdf-1', TARGET);
  seedPdf('admin-delete-account-pdf-2', TARGET);
  seedPdf('admin-delete-account-other-pdf', 'someone-else');
  const accountDir = seedAccountDir(TARGET);

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'DELETE', url: `/api/system/accounts/${TARGET}`, headers: ADMIN_HEADERS });
    assert.equal(resp.statusCode, 200, resp.body);
    const body = resp.json() as { ok: boolean; account_id: string; deleted_pdf_count: number; deleted_pdfs: string[]; account_deleted: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.account_id, TARGET);
    assert.equal(body.deleted_pdf_count, 2);
    assert.deepEqual(body.deleted_pdfs.sort(), ['admin-delete-account-pdf-1', 'admin-delete-account-pdf-2']);
    assert.equal(body.account_deleted, true);

    const targetCount = db.prepare(`SELECT COUNT(*) AS count FROM pdfs WHERE owner_sub = ?`).get(TARGET) as { count: number };
    assert.equal(targetCount.count, 0);
    assert.equal(Boolean(db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get('admin-delete-account-other-pdf')), true);
    assert.equal(fs.existsSync(path.join(config.storageRoot, 'admin-delete-account-pdf-1')), false);
    assert.equal(fs.existsSync(path.join(config.storageRoot, 'admin-delete-account-pdf-2')), false);
    assert.equal(fs.existsSync(path.join(config.storageRoot, 'admin-delete-account-other-pdf')), true);
    assert.equal(fs.existsSync(accountDir), false);
  } finally {
    await app.close();
    cleanup(TARGET);
  }
});

test('DELETE /api/system/accounts/:account_id rejects default, self, and admin accounts', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN, OTHER_ADMIN] });
  const app = await buildApp();
  try {
    for (const accountId of ['default', ADMIN, OTHER_ADMIN]) {
      const resp = await app.inject({ method: 'DELETE', url: `/api/system/accounts/${accountId}`, headers: ADMIN_HEADERS });
      assert.equal(resp.statusCode, 400, accountId);
      assert.equal((resp.json() as { error: { code: string } }).error.code, 'DANGEROUS_ACCOUNT');
    }
  } finally {
    await app.close();
  }
});

test('DELETE /api/system/accounts/:account_id is explicit and idempotent for an account with no PDFs or settings directory', async () => {
  const missingAccount = 'admin-delete-account-empty';
  cleanup(missingAccount);
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [ADMIN] });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'DELETE', url: `/api/system/accounts/${missingAccount}`, headers: ADMIN_HEADERS });
    assert.equal(resp.statusCode, 200, resp.body);
    assert.deepEqual(resp.json(), {
      ok: true,
      account_id: missingAccount,
      deleted_pdfs: [],
      deleted_pdf_count: 0,
      account_deleted: true,
    });
  } finally {
    await app.close();
    cleanup(missingAccount);
  }
});
