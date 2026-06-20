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

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedSyncPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, visibility, t, t);
}

test('POST /sync/join rejects a non-owner request on a private presentation', async () => {
  seedSyncPdf('syncjoin-priv-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/syncjoin-priv-01/sync/join', headers: OTHER_HEADERS, payload: { client_id: 'c1' } });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('POST /sync/join rejects an unauthenticated request on a private presentation', async () => {
  seedSyncPdf('syncjoin-anon-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/syncjoin-anon-01/sync/join', payload: { client_id: 'c1' } });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('POST /sync/join rejects a non-owner, non-collaborator request on a read-only public presentation', async () => {
  // Plain 'public' visibility is read-only; becoming sync master is an edit-level capability,
  // so a non-owner viewer should still be rejected (only canEditPdf()-eligible requests pass).
  seedSyncPdf('syncjoin-pub-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/syncjoin-pub-readonly-01/sync/join', headers: OTHER_HEADERS, payload: { client_id: 'c1' } });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('POST /sync/join allows the owner', async () => {
  seedSyncPdf('syncjoin-own-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/syncjoin-own-01/sync/join', headers: OWNER_HEADERS, payload: { client_id: 'c1' } });
  assert.equal(resp.statusCode, 200);
  assert.equal((resp.json() as { role: string }).role, 'master');
  await app.close();
});

test('POST /sync/join allows a read-write collaborator on a public_editable presentation', async () => {
  seedSyncPdf('syncjoin-editable-01', 'public_editable');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/syncjoin-editable-01/sync/join', headers: OTHER_HEADERS, payload: { client_id: 'c1' } });
  assert.equal(resp.statusCode, 200);
  await app.close();
});

test('POST /sync/join returns 404 for a non-existent PDF', async () => {
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/syncjoin-missing/sync/join', headers: OWNER_HEADERS, payload: { client_id: 'c1' } });
  assert.equal(resp.statusCode, 404);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');
  await app.close();
});
