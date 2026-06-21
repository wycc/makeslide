import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { getAccountDisplayNames, upsertAccountProfile } from '../src/services/accountProfiles';
import type { PdfListItem } from '../src/types';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const SELF = 'pdf-list-owner-self';
const OTHER = 'pdf-list-owner-other';
const SELF_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(SELF))}` };

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(id: string, ownerSub: string | null, visibility: 'private' | 'public' | 'public_editable'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', 1, ?, ?, ?, ?)`,
  ).run(id, id, `${id}.pdf`, ownerSub, visibility, t, t);
}

function cleanupPdfs(...ids: string[]): void {
  for (const id of ids) db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

function cleanupAccounts(...subs: string[]): void {
  for (const sub of subs) db.prepare(`DELETE FROM accounts WHERE sub = ?`).run(sub);
}

setSystemAuthSettings({ googleAuthEnabled: false });

test('upsertAccountProfile + getAccountDisplayNames: prefers name, falls back to email, ignores unknown subs', () => {
  cleanupAccounts('profile-a', 'profile-b');
  try {
    upsertAccountProfile({ sub: 'profile-a', email: 'a@example.com', name: 'Alice' });
    upsertAccountProfile({ sub: 'profile-b', email: 'b@example.com' });
    const names = getAccountDisplayNames(['profile-a', 'profile-b', 'profile-unknown', null, undefined]);
    assert.equal(names.get('profile-a'), 'Alice');
    assert.equal(names.get('profile-b'), 'b@example.com');
    assert.equal(names.has('profile-unknown'), false);
    assert.equal(names.size, 2);
  } finally {
    cleanupAccounts('profile-a', 'profile-b');
  }
});

test('upsertAccountProfile overwrites a previously stored name on a later login', () => {
  cleanupAccounts('profile-c');
  try {
    upsertAccountProfile({ sub: 'profile-c', email: 'c@example.com', name: 'Old Name' });
    upsertAccountProfile({ sub: 'profile-c', email: 'c@example.com', name: 'New Name' });
    const names = getAccountDisplayNames(['profile-c']);
    assert.equal(names.get('profile-c'), 'New Name');
  } finally {
    cleanupAccounts('profile-c');
  }
});

test('GET /api/pdfs omits presentations with no owner_sub', async () => {
  const ownerless = 'pdf-list-owner-ownerless-01';
  seedPdf(ownerless, null, 'public');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs', headers: SELF_HEADERS });
    assert.equal(resp.statusCode, 200);
    const items = resp.json() as PdfListItem[];
    assert.ok(!items.some((item) => item.id === ownerless), 'ownerless PDF must not be listed');
  } finally {
    await app.close();
    cleanupPdfs(ownerless);
  }
});

test('GET /api/pdfs includes a known owner\'s display name for someone else\'s public presentation', async () => {
  const pdfId = 'pdf-list-owner-other-known-01';
  cleanupAccounts(OTHER);
  seedPdf(pdfId, OTHER, 'public');
  upsertAccountProfile({ sub: OTHER, email: `${OTHER}@example.com`, name: 'Other Person' });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs', headers: SELF_HEADERS });
    assert.equal(resp.statusCode, 200);
    const items = resp.json() as PdfListItem[];
    const item = items.find((i) => i.id === pdfId);
    assert.ok(item, 'expected the other owner\'s public PDF to be listed');
    assert.equal(item!.owner_name, 'Other Person');
  } finally {
    await app.close();
    cleanupPdfs(pdfId);
    cleanupAccounts(OTHER);
  }
});

test('GET /api/pdfs returns owner_name=null for an owner who has never logged in', async () => {
  const pdfId = 'pdf-list-owner-other-unknown-01';
  const unknownOwner = 'pdf-list-owner-unknown-owner';
  cleanupAccounts(unknownOwner);
  seedPdf(pdfId, unknownOwner, 'public');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs', headers: SELF_HEADERS });
    assert.equal(resp.statusCode, 200);
    const items = resp.json() as PdfListItem[];
    const item = items.find((i) => i.id === pdfId);
    assert.ok(item, 'expected the unknown owner\'s public PDF to be listed');
    assert.equal(item!.owner_name, null);
  } finally {
    await app.close();
    cleanupPdfs(pdfId);
  }
});

test('GET /api/pdfs still excludes a private presentation owned by someone else', async () => {
  const pdfId = 'pdf-list-owner-other-private-01';
  seedPdf(pdfId, OTHER, 'private');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs', headers: SELF_HEADERS });
    assert.equal(resp.statusCode, 200);
    const items = resp.json() as PdfListItem[];
    assert.ok(!items.some((item) => item.id === pdfId), 'private presentation owned by someone else must not be listed');
  } finally {
    await app.close();
    cleanupPdfs(pdfId);
  }
});
