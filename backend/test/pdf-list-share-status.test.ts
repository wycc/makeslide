import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { getPdfShareSummaries } from '../src/routes/pdfs/shared';
import type { PdfListItem } from '../src/types';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(
    JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }),
    'utf8',
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER = 'share-status-owner';
const READER = 'share-status-reader';
const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(OWNER))}` };
const READER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(READER))}` };

const MINE = 'share-status-mine';
const SHARED_WITH_ME = 'share-status-theirs';

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(id: string, ownerSub: string, visibility: 'private' | 'public' | 'public_editable'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', 1, ?, ?, ?, ?)`,
  ).run(id, id, `${id}.pdf`, ownerSub, visibility, t, t);
}

function seedShareLink(token: string, pdfId: string, expiresAt: string | null): void {
  const t = nowIso();
  db.prepare(
    `INSERT INTO pdf_shares (token, pdf_id, access, expires_at, created_at, updated_at)
     VALUES (?, ?, 'read_only', ?, ?, ?)`,
  ).run(token, pdfId, expiresAt, t, t);
}

function seedPermission(pdfId: string, principalType: 'user' | 'group', principalId: string): void {
  const t = nowIso();
  db.prepare(
    `INSERT INTO pdf_permissions (pdf_id, principal_type, principal_id, access, created_at, updated_at)
     VALUES (?, ?, ?, 'read_only', ?, ?)`,
  ).run(pdfId, principalType, principalId, t, t);
}

function cleanup(...ids: string[]): void {
  for (const id of ids) {
    db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(id);
    db.prepare(`DELETE FROM pdf_permissions WHERE pdf_id = ?`).run(id);
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  }
}

setSystemAuthSettings({ googleAuthEnabled: false });

test('getPdfShareSummaries counts live links, expired links, users and groups per presentation', () => {
  cleanup(MINE);
  try {
    seedPdf(MINE, OWNER, 'private');
    seedShareLink(`${MINE}-live-1`, MINE, null);
    seedShareLink(`${MINE}-live-2`, MINE, '2099-01-01T00:00:00.000Z');
    seedShareLink(`${MINE}-dead`, MINE, '2000-01-01T00:00:00.000Z');
    seedPermission(MINE, 'user', 'a@example.com');
    seedPermission(MINE, 'user', 'b@example.com');
    seedPermission(MINE, 'group', 'group-1');

    const summary = getPdfShareSummaries().get(MINE);

    assert.ok(summary, 'the presentation should appear in the summary map');
    // A link with no expiry and one expiring in 2099 are both still usable; the
    // 2000 one is not, and is reported separately rather than inflating the count.
    assert.equal(summary.linkCount, 2);
    assert.equal(summary.expiredLinkCount, 1);
    assert.equal(summary.userCount, 2);
    assert.equal(summary.groupCount, 1);
  } finally {
    cleanup(MINE);
  }
});

test('getPdfShareSummaries omits presentations that were never shared', () => {
  cleanup(MINE);
  try {
    seedPdf(MINE, OWNER, 'private');
    assert.equal(getPdfShareSummaries().has(MINE), false);
  } finally {
    cleanup(MINE);
  }
});

test('GET /api/pdfs reports share counts to the owner', async () => {
  cleanup(MINE);
  const app = await buildApp();
  try {
    seedPdf(MINE, OWNER, 'public');
    seedShareLink(`${MINE}-live`, MINE, null);
    seedPermission(MINE, 'user', 'a@example.com');

    const res = await app.inject({ method: 'GET', url: '/api/pdfs', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200);
    const item = (res.json() as PdfListItem[]).find((p) => p.id === MINE);

    assert.ok(item, 'the owner should see their own presentation');
    assert.equal(item.share_link_count, 1);
    assert.equal(item.share_expired_link_count, 0);
    assert.equal(item.share_user_count, 1);
    assert.equal(item.share_group_count, 0);
  } finally {
    await app.close();
    cleanup(MINE);
  }
});

test('GET /api/pdfs reports zeroes, not undefined, for an owner who has shared nothing', async () => {
  // The distinction matters to the UI: absent means "not mine", zero means
  // "mine, and genuinely not shared".
  cleanup(MINE);
  const app = await buildApp();
  try {
    seedPdf(MINE, OWNER, 'private');

    const res = await app.inject({ method: 'GET', url: '/api/pdfs', headers: OWNER_HEADERS });
    const item = (res.json() as PdfListItem[]).find((p) => p.id === MINE);

    assert.ok(item);
    assert.equal(item.share_link_count, 0);
    assert.equal(item.share_user_count, 0);
    assert.equal(item.share_group_count, 0);
  } finally {
    await app.close();
    cleanup(MINE);
  }
});

test('GET /api/pdfs withholds share counts for a presentation someone else owns', async () => {
  // A reader who was granted access must not learn who else it was shared with.
  cleanup(SHARED_WITH_ME);
  const app = await buildApp();
  try {
    seedPdf(SHARED_WITH_ME, OWNER, 'private');
    seedShareLink(`${SHARED_WITH_ME}-live`, SHARED_WITH_ME, null);
    seedPermission(SHARED_WITH_ME, 'user', `${READER}@example.com`);
    seedPermission(SHARED_WITH_ME, 'user', 'someone-else@example.com');

    const res = await app.inject({ method: 'GET', url: '/api/pdfs', headers: READER_HEADERS });
    assert.equal(res.statusCode, 200);
    const item = (res.json() as PdfListItem[]).find((p) => p.id === SHARED_WITH_ME);

    assert.ok(item, 'the reader was granted access, so it should be listed');
    assert.equal(item.share_link_count, undefined);
    assert.equal(item.share_expired_link_count, undefined);
    assert.equal(item.share_user_count, undefined);
    assert.equal(item.share_group_count, undefined);
  } finally {
    await app.close();
    cleanup(SHARED_WITH_ME);
  }
});
