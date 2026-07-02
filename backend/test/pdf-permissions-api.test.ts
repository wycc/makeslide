import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import crypto from 'node:crypto';

function cookie(sub: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `makeslide_session=${encodeURIComponent(`${payload}.${signature}`)}`;
}

const OWNER = { cookie: cookie('perm-owner', 'owner@example.com'), 'content-type': 'application/json' };
const OTHER = { cookie: cookie('perm-other', 'other@example.com'), 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(id: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM pdf_permissions WHERE pdf_id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,'perm-owner','private',?,?)`,
  ).run(id, 't', `${id}.pdf`, t, t);
}

function seedAccount(sub: string, email: string, name: string): void {
  const t = nowIso();
  db.prepare(
    `INSERT INTO accounts (sub,email,name,picture,created_at,updated_at) VALUES (?,?,?,NULL,?,?)
     ON CONFLICT(sub) DO UPDATE SET email=excluded.email, name=excluded.name`,
  ).run(sub, email, name, t, t);
}

test('owner can add, list, update, and remove a user permission', async () => {
  seedPdf('permtest1');
  seedAccount('alice-sub', 'alice@example.com', 'Alice Wang');
  const app = await buildApp();
  try {
    // add read_only
    let resp = await app.inject({ method: 'PUT', url: '/api/pdfs/permtest1/permissions', headers: OWNER, payload: { email: 'alice@example.com', access: 'read_only' } });
    assert.equal(resp.statusCode, 200);

    // list — shows the entry with resolved display name and the default visibility
    resp = await app.inject({ method: 'GET', url: '/api/pdfs/permtest1/permissions', headers: OWNER });
    assert.equal(resp.statusCode, 200);
    let body = resp.json() as { default_visibility: string; permissions: Array<{ email: string; access: string; display_name: string | null }> };
    assert.equal(body.default_visibility, 'private');
    assert.equal(body.permissions.length, 1);
    assert.equal(body.permissions[0].email, 'alice@example.com');
    assert.equal(body.permissions[0].access, 'read_only');
    assert.equal(body.permissions[0].display_name, 'Alice Wang');

    // update to read_write (upsert, still one row)
    resp = await app.inject({ method: 'PUT', url: '/api/pdfs/permtest1/permissions', headers: OWNER, payload: { email: 'alice@example.com', access: 'read_write' } });
    assert.equal(resp.statusCode, 200);
    resp = await app.inject({ method: 'GET', url: '/api/pdfs/permtest1/permissions', headers: OWNER });
    body = resp.json() as typeof body;
    assert.equal(body.permissions.length, 1);
    assert.equal(body.permissions[0].access, 'read_write');

    // remove
    resp = await app.inject({ method: 'DELETE', url: '/api/pdfs/permtest1/permissions', headers: OWNER, payload: { email: 'alice@example.com' } });
    assert.equal(resp.statusCode, 200);
    resp = await app.inject({ method: 'GET', url: '/api/pdfs/permtest1/permissions', headers: OWNER });
    assert.equal((resp.json() as { permissions: unknown[] }).permissions.length, 0);
  } finally {
    await app.close();
  }
});

test('email is normalized to lowercase so casing does not create duplicates', async () => {
  seedPdf('permtest2');
  const app = await buildApp();
  try {
    await app.inject({ method: 'PUT', url: '/api/pdfs/permtest2/permissions', headers: OWNER, payload: { email: 'Bob@Example.com', access: 'read_only' } });
    await app.inject({ method: 'PUT', url: '/api/pdfs/permtest2/permissions', headers: OWNER, payload: { email: 'bob@example.com', access: 'read_write' } });
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs/permtest2/permissions', headers: OWNER });
    const body = resp.json() as { permissions: Array<{ email: string; access: string }> };
    assert.equal(body.permissions.length, 1);
    assert.equal(body.permissions[0].email, 'bob@example.com');
    assert.equal(body.permissions[0].access, 'read_write');
  } finally {
    await app.close();
  }
});

test('a non-owner cannot manage or view the ACL', async () => {
  seedPdf('permtest3');
  const app = await buildApp();
  try {
    let resp = await app.inject({ method: 'GET', url: '/api/pdfs/permtest3/permissions', headers: OTHER });
    assert.equal(resp.statusCode, 403);
    resp = await app.inject({ method: 'PUT', url: '/api/pdfs/permtest3/permissions', headers: OTHER, payload: { email: 'x@example.com', access: 'read_only' } });
    assert.equal(resp.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('account search matches by email and display name for the picker', async () => {
  seedAccount('search-sub-1', 'carol.teacher@example.com', 'Carol Chen');
  const app = await buildApp();
  try {
    let resp = await app.inject({ method: 'GET', url: '/api/accounts/search?q=carol.teacher', headers: OWNER });
    assert.equal(resp.statusCode, 200);
    let accounts = (resp.json() as { accounts: Array<{ email: string; display_name: string }> }).accounts;
    assert.ok(accounts.some((a) => a.email === 'carol.teacher@example.com' && a.display_name === 'Carol Chen'));

    // by display name
    resp = await app.inject({ method: 'GET', url: '/api/accounts/search?q=Carol Chen', headers: OWNER });
    accounts = (resp.json() as { accounts: Array<{ email: string }> }).accounts;
    assert.ok(accounts.some((a) => a.email === 'carol.teacher@example.com'));
  } finally {
    await app.close();
  }
});

test('account search requires authentication', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/accounts/search?q=carol' });
    assert.equal(resp.statusCode, 401);
  } finally {
    await app.close();
  }
});
