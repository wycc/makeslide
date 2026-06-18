import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import crypto from 'node:crypto';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const SESSION_COOKIE = testSessionCookie('account-1');

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedGithubSyncPdf(pdfId: string, ownerSub: string | null, visibility: 'private' | 'public' | 'public_editable'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,?,?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, ownerSub, visibility, t, t);
}

test('POST /api/pdfs/:id/github-sync rejects read-only access for a non-owner', async () => {
  seedGithubSyncPdf('github-sync-readonly-01', 'account-2', 'public');

  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/github-sync-readonly-01/github-sync',
    headers: { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` },
  });

  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');

  await app.close();
});

test('POST /api/pdfs/:id/github-sync rejects a private presentation owned by someone else', async () => {
  seedGithubSyncPdf('github-sync-private-01', 'account-2', 'private');

  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/github-sync-private-01/github-sync',
    headers: { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` },
  });

  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');

  await app.close();
});

test('POST /api/pdfs/:id/github-sync allows the owner past the permission check', async () => {
  seedGithubSyncPdf('github-sync-owner-01', 'account-1', 'private');

  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/github-sync-owner-01/github-sync',
    headers: { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` },
  });

  // No GitHub repo configured in the test environment, so the owner should
  // fail past the permission check on the "not configured" branch, not 403.
  assert.equal(resp.statusCode, 400);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'GITHUB_NOT_CONFIGURED');

  await app.close();
});

test('POST /api/pdfs/:id/github-sync allows a read-write collaborator past the permission check', async () => {
  seedGithubSyncPdf('github-sync-editable-01', 'account-2', 'public_editable');

  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/github-sync-editable-01/github-sync',
    headers: { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` },
  });

  assert.equal(resp.statusCode, 400);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'GITHUB_NOT_CONFIGURED');

  await app.close();
});
