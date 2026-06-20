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

function syncStatePayload(clientId: string) {
  return { client_id: clientId, page_number: 1, is_playing: true, current_time: 0 };
}

test('POST /sync/state rejects a request with no edit access from claiming master when no master is active', async () => {
  // Without ever calling /sync/join, a request with zero read/edit access to a private
  // presentation must not be able to claim the master role just by hitting /sync/state directly
  // during the window where no master is currently active.
  seedSyncPdf('syncstate-priv-noaccess-01', 'private');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/syncstate-priv-noaccess-01/sync/state',
      headers: OTHER_HEADERS,
      payload: syncStatePayload('attacker-1'),
    });
    assert.equal(resp.statusCode, 403);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  } finally {
    await app.close();
  }
});

test('POST /sync/state allows the owner to claim master directly without calling /sync/join first', async () => {
  seedSyncPdf('syncstate-priv-owner-01', 'private');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/syncstate-priv-owner-01/sync/state',
      headers: OWNER_HEADERS,
      payload: syncStatePayload('owner-client-1'),
    });
    assert.equal(resp.statusCode, 200);
    assert.equal((resp.json() as { role: string }).role, 'master');
  } finally {
    await app.close();
  }
});

test('POST /sync/state still requires the existing master\'s client_id once a master is already active', async () => {
  // Once a legitimate master is active, a second client without edit access still correctly
  // gets SYNC_NOT_MASTER (not FORBIDDEN) — confirming this fix only closes the "no master yet"
  // window and doesn't change the existing master-mismatch behavior.
  seedSyncPdf('syncstate-pub-existing-master-01', 'public_editable');
  const app = await buildApp();
  try {
    const claim = await app.inject({
      method: 'POST',
      url: '/api/pdfs/syncstate-pub-existing-master-01/sync/state',
      headers: OWNER_HEADERS,
      payload: syncStatePayload('owner-client-1'),
    });
    assert.equal(claim.statusCode, 200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/pdfs/syncstate-pub-existing-master-01/sync/state',
      headers: OTHER_HEADERS,
      payload: syncStatePayload('other-client-1'),
    });
    assert.equal(second.statusCode, 403);
    assert.equal((second.json() as { error: { code: string } }).error.code, 'SYNC_NOT_MASTER');
  } finally {
    await app.close();
  }
});
