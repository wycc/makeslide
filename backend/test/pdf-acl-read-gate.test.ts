import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import crypto from 'node:crypto';

function sessionCookie(sub: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `makeslide_session=${encodeURIComponent(`${payload}.${signature}`)}`;
}

const OWNER = { cookie: sessionCookie('owner-acl', 'owner-acl@example.com'), 'content-type': 'application/json' };
const READER = { cookie: sessionCookie('reader-acl', 'reader@example.com'), 'content-type': 'application/json' };
const EDITOR = { cookie: sessionCookie('editor-acl', 'editor@example.com'), 'content-type': 'application/json' };
const STRANGER = { cookie: sessionCookie('stranger-acl', 'stranger@example.com'), 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(id: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,'owner-acl','private',?,?)`,
  ).run(id, 't', `${id}.pdf`, t, t);
}

function grant(pdfId: string, email: string, access: 'read_only' | 'read_write'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdf_permissions WHERE pdf_id = ? AND principal_id = ?`).run(pdfId, email);
  db.prepare(
    `INSERT INTO pdf_permissions (pdf_id, principal_type, principal_id, access, created_at, updated_at)
     VALUES (?, 'user', ?, ?, ?, ?)`,
  ).run(pdfId, email, access, t, t);
}

test('a read-only listed user can open a private presentation and sees access_level=read', async () => {
  seedPdf('acl-read-1');
  grant('acl-read-1', 'reader@example.com', 'read_only');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs/acl-read-1', headers: READER });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { access_level: string; is_owner: boolean };
    assert.equal(body.access_level, 'read');
    assert.equal(body.is_owner, false);
  } finally {
    await app.close();
  }
});

test('a read-write listed user opens a private presentation with access_level=edit', async () => {
  seedPdf('acl-read-2');
  grant('acl-read-2', 'editor@example.com', 'read_write');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs/acl-read-2', headers: EDITOR });
    assert.equal(resp.statusCode, 200);
    assert.equal((resp.json() as { access_level: string }).access_level, 'edit');
  } finally {
    await app.close();
  }
});

test('an unlisted user is still forbidden from a private presentation', async () => {
  seedPdf('acl-read-3');
  grant('acl-read-3', 'reader@example.com', 'read_only');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs/acl-read-3', headers: STRANGER });
    assert.equal(resp.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('the owner sees access_level=edit regardless of the ACL', async () => {
  seedPdf('acl-read-4');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs/acl-read-4', headers: OWNER });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { access_level: string; is_owner: boolean };
    assert.equal(body.access_level, 'edit');
    assert.equal(body.is_owner, true);
  } finally {
    await app.close();
  }
});

test('a listed private presentation appears in the read-only user\'s list', async () => {
  seedPdf('acl-read-5');
  grant('acl-read-5', 'reader@example.com', 'read_only');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs', headers: READER });
    assert.equal(resp.statusCode, 200);
    const ids = (resp.json() as Array<{ id: string }>).map((r) => r.id);
    assert.ok(ids.includes('acl-read-5'), 'listed deck should appear in the reader\'s list');
  } finally {
    await app.close();
  }
});
