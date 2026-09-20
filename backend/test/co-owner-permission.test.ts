import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { decidePdfAccessLevel, resolvePdfOwnerAccess } from '../src/routes/pdfs/pdfAccess';

// A co-owner is a user the owner listed in the ACL with access = 'owner'. They share every
// owner-only action (sync master / starting a quiz, visibility, ACL management, share links,
// quiz recordings) — except deleting the whole presentation, which stays with the real owner.

function sessionCookie(sub: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `makeslide_session=${encodeURIComponent(`${payload}.${signature}`)}`;
}

const OWNER = { cookie: sessionCookie('coown-owner', 'coown-owner@example.com'), 'content-type': 'application/json' };
const CO_OWNER = { cookie: sessionCookie('coown-delegate', 'Delegate@Example.com'), 'content-type': 'application/json' };
const EDITOR = { cookie: sessionCookie('coown-editor', 'coown-editor@example.com'), 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(id: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,'coown-owner','private',?,?)`,
  ).run(id, 't', `${id}.pdf`, t, t);
}

function grant(pdfId: string, email: string, access: 'read_only' | 'read_write' | 'owner'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdf_permissions WHERE pdf_id = ? AND principal_id = ?`).run(pdfId, email);
  db.prepare(
    `INSERT INTO pdf_permissions (pdf_id, principal_type, principal_id, access, created_at, updated_at)
     VALUES (?, 'user', ?, ?, ?, ?)`,
  ).run(pdfId, email, access, t, t);
}

test('decidePdfAccessLevel: an owner grant gives edit-level content access', () => {
  assert.equal(
    decidePdfAccessLevel({ ownerSub: 'o', visibility: 'private', userSub: 'u', matchedGrants: ['owner'] }),
    'edit',
  );
});

test('resolvePdfOwnerAccess: matches the ACL owner grant by email case-insensitively, not other grants', () => {
  seedPdf('coown-resolve');
  grant('coown-resolve', 'delegate@example.com', 'owner');
  grant('coown-resolve', 'coown-editor@example.com', 'read_write');
  const row = { owner_sub: 'coown-owner' };
  assert.equal(resolvePdfOwnerAccess('coown-resolve', 'coown-owner', 'coown-owner@example.com', row), true);
  assert.equal(resolvePdfOwnerAccess('coown-resolve', 'coown-delegate', 'DELEGATE@example.com', row), true);
  assert.equal(resolvePdfOwnerAccess('coown-resolve', 'coown-editor', 'coown-editor@example.com', row), false);
  // An unauthenticated request never resolves to owner, even if the email were somehow known.
  assert.equal(resolvePdfOwnerAccess('coown-resolve', null, 'delegate@example.com', row), false);
});

test('GET /api/pdfs/:id reports a co-owner as is_owner with is_co_owner=true and edit access', async () => {
  seedPdf('coown-detail');
  grant('coown-detail', 'delegate@example.com', 'owner');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs/coown-detail', headers: CO_OWNER });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { is_owner: boolean; is_co_owner: boolean; access_level: string };
    assert.equal(body.is_owner, true);
    assert.equal(body.is_co_owner, true);
    assert.equal(body.access_level, 'edit');

    const own = await app.inject({ method: 'GET', url: '/api/pdfs/coown-detail', headers: OWNER });
    const ownBody = own.json() as { is_owner: boolean; is_co_owner: boolean };
    assert.equal(ownBody.is_owner, true);
    assert.equal(ownBody.is_co_owner, false);
  } finally {
    await app.close();
  }
});

test('a co-owner can take the sync master role (start a quiz); a read-write editor still cannot', async () => {
  seedPdf('coown-sync');
  grant('coown-sync', 'delegate@example.com', 'owner');
  grant('coown-sync', 'coown-editor@example.com', 'read_write');
  const app = await buildApp();
  try {
    const join = await app.inject({ method: 'POST', url: '/api/pdfs/coown-sync/sync/join', headers: CO_OWNER, payload: { client_id: 'co-1' } });
    assert.equal(join.statusCode, 200);
    assert.equal((join.json() as { role: string }).role, 'master');

    const state = await app.inject({
      method: 'POST',
      url: '/api/pdfs/coown-sync/sync/state',
      headers: CO_OWNER,
      payload: { client_id: 'co-1', page_number: 1, is_playing: false, current_time: 0, quiz_mode: true, quiz_session_reset: true },
    });
    assert.equal(state.statusCode, 200);

    const editorJoin = await app.inject({ method: 'POST', url: '/api/pdfs/coown-sync/sync/join', headers: EDITOR, payload: { client_id: 'ed-1' } });
    assert.equal(editorJoin.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('a co-owner can change the default permission and manage the ACL', async () => {
  seedPdf('coown-admin');
  grant('coown-admin', 'delegate@example.com', 'owner');
  const app = await buildApp();
  try {
    const vis = await app.inject({ method: 'PATCH', url: '/api/pdfs/coown-admin/visibility', headers: CO_OWNER, payload: { visibility: 'public' } });
    assert.equal(vis.statusCode, 200);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/pdfs/coown-admin/permissions',
      headers: CO_OWNER,
      payload: { email: 'coown-editor@example.com', access: 'read_write' },
    });
    assert.equal(put.statusCode, 200);

    const list = await app.inject({ method: 'GET', url: '/api/pdfs/coown-admin/permissions', headers: CO_OWNER });
    assert.equal(list.statusCode, 200);
    const perms = (list.json() as { permissions: Array<{ email: string | null; access: string }> }).permissions;
    assert.ok(perms.some((p) => p.email === 'coown-editor@example.com' && p.access === 'read_write'));
    assert.ok(perms.some((p) => p.email === 'delegate@example.com' && p.access === 'owner'));
  } finally {
    await app.close();
  }
});

test('the owner can grant, and revoke, co-ownership through the ACL API', async () => {
  seedPdf('coown-grant');
  const app = await buildApp();
  try {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/pdfs/coown-grant/permissions',
      headers: OWNER,
      payload: { email: 'delegate@example.com', access: 'owner' },
    });
    assert.equal(put.statusCode, 200);
    assert.equal((put.json() as { access: string }).access, 'owner');

    const asCoOwner = await app.inject({ method: 'GET', url: '/api/pdfs/coown-grant/permissions', headers: CO_OWNER });
    assert.equal(asCoOwner.statusCode, 200);

    const del = await app.inject({ method: 'DELETE', url: '/api/pdfs/coown-grant/permissions', headers: OWNER, payload: { email: 'delegate@example.com' } });
    assert.equal(del.statusCode, 200);
    const revoked = await app.inject({ method: 'GET', url: '/api/pdfs/coown-grant/permissions', headers: CO_OWNER });
    assert.equal(revoked.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('a group cannot be granted co-ownership', async () => {
  seedPdf('coown-group');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'PUT',
      url: '/api/pdfs/coown-group/permissions',
      headers: OWNER,
      payload: { group_id: 'grp-abcdefghij', access: 'owner' },
    });
    assert.equal(resp.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('a co-owner cannot delete the whole presentation', async () => {
  seedPdf('coown-delete');
  grant('coown-delete', 'delegate@example.com', 'owner');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'DELETE', url: '/api/pdfs/coown-delete', headers: CO_OWNER });
    assert.equal(resp.statusCode, 403);
    assert.ok(db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get('coown-delete'));
  } finally {
    await app.close();
  }
});
