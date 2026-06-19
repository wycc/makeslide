import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}` };

const FAKE_HASH = '0123456789abcdef0123456789abcdef01234567';

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedVersioningPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, visibility, t, t);
  const uid = 'verperm1';
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, `${uid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
  fs.writeFileSync(path.join(pagesDir, `${uid}.text.txt`), 'text', 'utf8');
  fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), 'script', 'utf8');
}

test('POST .../image/restore/:hash rejects a non-owner request on a read-only shared presentation', async () => {
  seedVersioningPdf('verperm-img-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/verperm-img-readonly-01/pages/1/image/restore/${FAKE_HASH}`,
    headers: OTHER_HEADERS,
  });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('POST .../script/restore/:hash rejects a non-owner request on a private presentation', async () => {
  seedVersioningPdf('verperm-script-private-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/verperm-script-private-01/pages/1/script/restore/${FAKE_HASH}`,
    headers: OTHER_HEADERS,
  });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('POST .../image/restore/:hash and .../script/restore/:hash return 404 for an unknown presentation', async () => {
  const app = await buildApp();
  const imageResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/verperm-missing-01/pages/1/image/restore/${FAKE_HASH}`,
    headers: OWNER_HEADERS,
  });
  assert.equal(imageResp.statusCode, 404);
  assert.equal((imageResp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');

  const scriptResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/verperm-missing-01/pages/1/script/restore/${FAKE_HASH}`,
    headers: OWNER_HEADERS,
  });
  assert.equal(scriptResp.statusCode, 404);
  assert.equal((scriptResp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');
  await app.close();
});

// The owner/public_editable pass-through is verified by reaching the PAGE_NOT_FOUND
// branch (a different error than the permission check's 403) without needing a real
// git history fixture for restorePresentationFile() to operate on.
test('POST .../image/restore/:hash and .../script/restore/:hash let the owner past the permission check', async () => {
  seedVersioningPdf('verperm-owner-01', 'private');
  db.prepare(`UPDATE pages SET image_path = NULL, script_path = NULL WHERE pdf_id = ? AND page_number = 1`).run('verperm-owner-01');
  const app = await buildApp();
  const imageResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/verperm-owner-01/pages/1/image/restore/${FAKE_HASH}`,
    headers: OWNER_HEADERS,
  });
  assert.equal(imageResp.statusCode, 404);
  assert.equal((imageResp.json() as { error: { code: string } }).error.code, 'PAGE_NOT_FOUND');

  const scriptResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/verperm-owner-01/pages/1/script/restore/${FAKE_HASH}`,
    headers: OWNER_HEADERS,
  });
  assert.equal(scriptResp.statusCode, 404);
  assert.equal((scriptResp.json() as { error: { code: string } }).error.code, 'PAGE_NOT_FOUND');
  await app.close();
});

test('POST .../image/restore/:hash lets a read-write collaborator on a public_editable presentation past the permission check', async () => {
  seedVersioningPdf('verperm-editable-01', 'public_editable');
  db.prepare(`UPDATE pages SET image_path = NULL WHERE pdf_id = ? AND page_number = 1`).run('verperm-editable-01');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/verperm-editable-01/pages/1/image/restore/${FAKE_HASH}`,
    headers: OTHER_HEADERS,
  });
  assert.equal(resp.statusCode, 404);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'PAGE_NOT_FOUND');
  await app.close();
});

// --- GET history/version endpoints: read-permission gate ---

function seedShareToken(pdfId: string, token: string, access: 'read_only' | 'editable' = 'read_only'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`INSERT INTO pdf_shares (pdf_id, token, access, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(pdfId, token, access, t, t);
}

/**
 * Each route is exercised against a freshly seeded PDF. For the "should be let through"
 * cases, `image_path`/`script_path` is nulled out so the route deterministically hits the
 * existing `PAGE_NOT_FOUND` branch right after the permission check, without needing a real
 * git history fixture for `getPresentationFileHistory()`/`getPresentationFileAtCommit()`.
 */
const GET_ROUTES = [
  { name: 'image history', path: (id: string) => `/api/pdfs/${id}/pages/1/image/history`, nullPath: 'image_path' },
  { name: 'script history', path: (id: string) => `/api/pdfs/${id}/pages/1/script/history`, nullPath: 'script_path' },
  { name: 'script version content', path: (id: string) => `/api/pdfs/${id}/pages/1/script/versions/${FAKE_HASH}`, nullPath: 'script_path' },
  { name: 'image version content', path: (id: string) => `/api/pdfs/${id}/pages/1/image/versions/${FAKE_HASH}`, nullPath: 'image_path' },
] as const;

let getRouteCounter = 0;

for (const route of GET_ROUTES) {
  test(`GET ${route.name} rejects a non-owner request on a private presentation`, async () => {
    const pdfId = `verperm-get-priv-${getRouteCounter++}`;
    seedVersioningPdf(pdfId, 'private');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId), headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 403);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
    await app.close();
  });

  test(`GET ${route.name} rejects an unauthenticated request on a private presentation`, async () => {
    const pdfId = `verperm-get-anon-${getRouteCounter++}`;
    seedVersioningPdf(pdfId, 'private');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId) });
    assert.equal(resp.statusCode, 403);
    await app.close();
  });

  test(`GET ${route.name} returns 404 for a non-existent PDF`, async () => {
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path('verperm-get-missing'), headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 404);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');
    await app.close();
  });

  test(`GET ${route.name} lets the owner past the permission check`, async () => {
    const pdfId = `verperm-get-own-${getRouteCounter++}`;
    seedVersioningPdf(pdfId, 'private');
    db.prepare(`UPDATE pages SET ${route.nullPath} = NULL WHERE pdf_id = ? AND page_number = 1`).run(pdfId);
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId), headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 404);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'PAGE_NOT_FOUND');
    await app.close();
  });

  test(`GET ${route.name} lets anyone on a public presentation past the permission check`, async () => {
    const pdfId = `verperm-get-pub-${getRouteCounter++}`;
    seedVersioningPdf(pdfId, 'public');
    db.prepare(`UPDATE pages SET ${route.nullPath} = NULL WHERE pdf_id = ? AND page_number = 1`).run(pdfId);
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId), headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 404);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'PAGE_NOT_FOUND');
    await app.close();
  });

  test(`GET ${route.name} lets a valid read-only share token without a session past the permission check`, async () => {
    const pdfId = `verperm-get-share-${getRouteCounter++}`;
    seedVersioningPdf(pdfId, 'private');
    db.prepare(`UPDATE pages SET ${route.nullPath} = NULL WHERE pdf_id = ? AND page_number = 1`).run(pdfId);
    const token = `verperm-token-${getRouteCounter++}`;
    seedShareToken(pdfId, token, 'read_only');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: `${route.path(pdfId)}?share=${token}` });
    assert.equal(resp.statusCode, 404);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'PAGE_NOT_FOUND');
    await app.close();
  });
}
