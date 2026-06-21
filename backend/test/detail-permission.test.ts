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

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedDetailPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM page_generation_prompts WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, visibility, t, t);
  const uid = 'detperm1';
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, `${uid}.text.txt`), 'prompt text', 'utf8');
  fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), 'script text', 'utf8');
}

function seedShareToken(pdfId: string, token: string, access: 'read_only' | 'editable' = 'read_only'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ? OR token = ?`).run(pdfId, token);
  db.prepare(`INSERT INTO pdf_shares (pdf_id, token, access, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(pdfId, token, access, t, t);
}

// --- GET /pages/:n/prompt ---

test('GET /pages/:n/prompt rejects a non-owner request on a private presentation', async () => {
  seedDetailPdf('detperm-prompt-priv-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: '/api/pdfs/detperm-prompt-priv-01/pages/1/prompt', headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('GET /pages/:n/prompt allows the owner', async () => {
  seedDetailPdf('detperm-prompt-own-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: '/api/pdfs/detperm-prompt-own-01/pages/1/prompt', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  await app.close();
});

test('GET /pages/:n/prompt allows a valid read-only share token without a session', async () => {
  seedDetailPdf('detperm-prompt-shr-01', 'private');
  const token = 'detperm-prompt-share-token-01';
  seedShareToken('detperm-prompt-shr-01', token, 'read_only');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/detperm-prompt-shr-01/pages/1/prompt?share=${token}` });
  assert.equal(resp.statusCode, 200);
  await app.close();
});

// --- PATCH /pages/:n/prompt ---

test('PATCH /pages/:n/prompt rejects a non-owner request on a read-only shared presentation', async () => {
  seedDetailPdf('detperm-prompt-patch-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'PATCH',
    url: '/api/pdfs/detperm-prompt-patch-01/pages/1/prompt',
    headers: OTHER_HEADERS,
    payload: { prompt: 'malicious overwrite' },
  });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('PATCH /pages/:n/prompt allows the owner to update the prompt', async () => {
  seedDetailPdf('detperm-prompt-patch-own-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'PATCH',
    url: '/api/pdfs/detperm-prompt-patch-own-01/pages/1/prompt',
    headers: OWNER_HEADERS,
    payload: { prompt: 'updated prompt' },
  });
  assert.equal(resp.statusCode, 200);
  await app.close();
});

// --- PUT /pages/:n/script ---

test('PUT /pages/:n/script rejects a non-owner request on a read-only shared presentation', async () => {
  seedDetailPdf('detperm-script-put-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'PUT',
    url: '/api/pdfs/detperm-script-put-01/pages/1/script',
    headers: OTHER_HEADERS,
    payload: { script: 'malicious overwrite' },
  });
  assert.equal(resp.statusCode, 403);
  const row = db.prepare(`SELECT script_path FROM pages WHERE pdf_id = ? AND page_number = 1`).get('detperm-script-put-01') as { script_path: string };
  const content = fs.readFileSync(path.join(config.storageRoot, 'detperm-script-put-01', row.script_path), 'utf8');
  assert.equal(content, 'script text');
  await app.close();
});

test('PUT /pages/:n/script allows the owner to update the script', async () => {
  seedDetailPdf('detperm-script-put-own-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'PUT',
    url: '/api/pdfs/detperm-script-put-own-01/pages/1/script',
    headers: OWNER_HEADERS,
    payload: { script: 'updated script' },
  });
  assert.equal(resp.statusCode, 200);
  await app.close();
});

test('PUT /pages/:n/script returns 404 for a non-existent PDF', async () => {
  const app = await buildApp();
  const resp = await app.inject({
    method: 'PUT',
    url: '/api/pdfs/detperm-script-missing/pages/1/script',
    headers: OWNER_HEADERS,
    payload: { script: 'x' },
  });
  assert.equal(resp.statusCode, 404);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');
  await app.close();
});

// --- GET /pages/:n/generation-prompts ---

test('GET /pages/:n/generation-prompts rejects a non-owner request on a private presentation', async () => {
  seedDetailPdf('detperm-genprompts-priv-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: '/api/pdfs/detperm-genprompts-priv-01/pages/1/generation-prompts', headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('GET /pages/:n/generation-prompts allows the owner', async () => {
  seedDetailPdf('detperm-genprompts-own-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: '/api/pdfs/detperm-genprompts-own-01/pages/1/generation-prompts', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  await app.close();
});

test('GET /pages/:n/generation-prompts returns 404 for a non-existent PDF', async () => {
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: '/api/pdfs/detperm-genprompts-missing/pages/1/generation-prompts', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 404);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');
  await app.close();
});

// --- GET /pages/:n/image, /thumbnail, /text, /script, /audio: read-permission gate ---
// The seeded page's image/audio files are never written to disk, so a request that passes
// the permission check deterministically falls through to the existing
// PAGE_IMAGE_NOT_FOUND/PAGE_AUDIO_NOT_FOUND branch (a different error than the permission
// check's 403/404), proving the gate itself works without needing real media fixtures.
const PAGE_CONTENT_ROUTES = [
  { name: 'image', path: (id: string) => `/api/pdfs/${id}/pages/1/image` },
  { name: 'thumbnail', path: (id: string) => `/api/pdfs/${id}/pages/1/thumbnail` },
  { name: 'text', path: (id: string) => `/api/pdfs/${id}/pages/1/text` },
  { name: 'script', path: (id: string) => `/api/pdfs/${id}/pages/1/script` },
  { name: 'audio', path: (id: string) => `/api/pdfs/${id}/pages/1/audio` },
] as const;

let pageContentCounter = 0;

for (const route of PAGE_CONTENT_ROUTES) {
  test(`GET ${route.name} rejects a non-owner request on a private presentation`, async () => {
    const pdfId = `detperm-content-priv-${pageContentCounter++}`;
    seedDetailPdf(pdfId, 'private');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId), headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 403);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
    await app.close();
  });

  test(`GET ${route.name} rejects an unauthenticated request on a private presentation`, async () => {
    const pdfId = `detperm-content-anon-${pageContentCounter++}`;
    seedDetailPdf(pdfId, 'private');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId) });
    assert.equal(resp.statusCode, 403);
    await app.close();
  });

  test(`GET ${route.name} returns 404 for a non-existent PDF`, async () => {
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path('detperm-content-missing'), headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 404);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');
    await app.close();
  });

  test(`GET ${route.name} lets the owner past the permission check`, async () => {
    const pdfId = `detperm-content-own-${pageContentCounter++}`;
    seedDetailPdf(pdfId, 'private');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId), headers: OWNER_HEADERS });
    assert.notEqual(resp.statusCode, 403);
    await app.close();
  });

  test(`GET ${route.name} lets anyone on a public presentation past the permission check`, async () => {
    const pdfId = `detperm-content-pub-${pageContentCounter++}`;
    seedDetailPdf(pdfId, 'public');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId), headers: OTHER_HEADERS });
    assert.notEqual(resp.statusCode, 403);
    await app.close();
  });

  test(`GET ${route.name} lets a valid read-only share token without a session past the permission check`, async () => {
    const pdfId = `detperm-content-shr-${pageContentCounter++}`;
    seedDetailPdf(pdfId, 'private');
    const token = `detperm-content-token-${pageContentCounter++}`;
    seedShareToken(pdfId, token, 'read_only');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: `${route.path(pdfId)}?share=${token}` });
    assert.notEqual(resp.statusCode, 403);
    await app.close();
  });
}

// --- GET /cover, /cover/thumbnail, /video, /outline, /source-audio, /pages/:n/polls: read-permission gate ---
// None of these media/source files are ever written to disk by the seed helper, so a request
// that passes the permission check deterministically falls through to the existing
// COVER_NOT_READY/VIDEO_NOT_FOUND/OUTLINE_NOT_FOUND/SOURCE_AUDIO_NOT_FOUND 404 branch.
const MEDIA_ROUTES = [
  { name: 'cover', path: (id: string) => `/api/pdfs/${id}/cover` },
  { name: 'cover thumbnail', path: (id: string) => `/api/pdfs/${id}/cover/thumbnail` },
  { name: 'video', path: (id: string) => `/api/pdfs/${id}/video` },
  { name: 'outline', path: (id: string) => `/api/pdfs/${id}/outline` },
  { name: 'source-audio', path: (id: string) => `/api/pdfs/${id}/source-audio` },
  { name: 'page polls', path: (id: string) => `/api/pdfs/${id}/pages/1/polls` },
] as const;

let mediaRouteCounter = 0;

for (const route of MEDIA_ROUTES) {
  test(`GET ${route.name} rejects a non-owner request on a private presentation`, async () => {
    const pdfId = `detperm-media-priv-${mediaRouteCounter++}`;
    seedDetailPdf(pdfId, 'private');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId), headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 403);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
    await app.close();
  });

  test(`GET ${route.name} rejects an unauthenticated request on a private presentation`, async () => {
    const pdfId = `detperm-media-anon-${mediaRouteCounter++}`;
    seedDetailPdf(pdfId, 'private');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId) });
    assert.equal(resp.statusCode, 403);
    await app.close();
  });

  test(`GET ${route.name} returns 404 for a non-existent PDF`, async () => {
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path('detperm-media-missing'), headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 404);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');
    await app.close();
  });

  test(`GET ${route.name} lets the owner past the permission check`, async () => {
    const pdfId = `detperm-media-own-${mediaRouteCounter++}`;
    seedDetailPdf(pdfId, 'private');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId), headers: OWNER_HEADERS });
    assert.notEqual(resp.statusCode, 403);
    await app.close();
  });

  test(`GET ${route.name} lets anyone on a public presentation past the permission check`, async () => {
    const pdfId = `detperm-media-pub-${mediaRouteCounter++}`;
    seedDetailPdf(pdfId, 'public');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: route.path(pdfId), headers: OTHER_HEADERS });
    assert.notEqual(resp.statusCode, 403);
    await app.close();
  });

  test(`GET ${route.name} lets a valid read-only share token without a session past the permission check`, async () => {
    const pdfId = `detperm-media-shr-${mediaRouteCounter++}`;
    seedDetailPdf(pdfId, 'private');
    const token = `detperm-media-token-${mediaRouteCounter++}`;
    seedShareToken(pdfId, token, 'read_only');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: `${route.path(pdfId)}?share=${token}` });
    assert.notEqual(resp.statusCode, 403);
    await app.close();
  });
}

// --- GET /pages/:n/subtitle-timeline ---

test('GET /pages/:n/subtitle-timeline rejects a non-owner request on a private presentation', async () => {
  seedDetailPdf('detperm-timeline-priv-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: '/api/pdfs/detperm-timeline-priv-01/pages/1/subtitle-timeline', headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('GET /pages/:n/subtitle-timeline returns 404 for an unknown PDF', async () => {
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: '/api/pdfs/detperm-timeline-missing/pages/1/subtitle-timeline', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 404);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');
  await app.close();
});

test('GET /pages/:n/subtitle-timeline returns { timeline: null } when no Whisper timeline has been generated', async () => {
  seedDetailPdf('detperm-timeline-absent-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: '/api/pdfs/detperm-timeline-absent-01/pages/1/subtitle-timeline', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  assert.deepEqual(resp.json(), { timeline: null });
  await app.close();
});

test('GET /pages/:n/subtitle-timeline returns the persisted timeline when one exists', async () => {
  const pdfId = 'detperm-timeline-present-01';
  seedDetailPdf(pdfId, 'private');
  const uid = 'detperm1';
  const timeline = [{ text: '大家好', start: 0, end: 1.2 }, { text: '今天來介紹一下', start: 1.2, end: 3 }];
  fs.writeFileSync(path.join(config.storageRoot, pdfId, 'pages', `${uid}.timeline.json`), JSON.stringify(timeline), 'utf8');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/subtitle-timeline`, headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  assert.deepEqual(resp.json(), { timeline });
  await app.close();
});

// --- GET /api/pdfs/:id is_owner flag ---
// The frontend treats the owner as always read-write, even when the PDF's own
// visibility/share link marks it read-only for everyone else; that decision
// hinges entirely on this `is_owner` flag in the detail response.

test('GET /api/pdfs/:id marks the owner as is_owner=true even when the presentation is publicly read-only shared', async () => {
  const pdfId = 'detperm-isowner-pub-own-01';
  seedDetailPdf(pdfId, 'public');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}`, headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  assert.equal((resp.json() as { is_owner?: boolean }).is_owner, true);
  await app.close();
});

test('GET /api/pdfs/:id marks a non-owner viewer as is_owner=false on a public presentation', async () => {
  const pdfId = 'detperm-isowner-pub-other-01';
  seedDetailPdf(pdfId, 'public');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}`, headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 200);
  assert.equal((resp.json() as { is_owner?: boolean }).is_owner, false);
  await app.close();
});

test('GET /api/pdfs/:id marks the owner as is_owner=true even when opened through a read-only share link', async () => {
  const pdfId = 'detperm-isowner-share-own-01';
  seedDetailPdf(pdfId, 'private');
  const token = 'detperm-isowner-share-token-01';
  seedShareToken(pdfId, token, 'read_only');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}?share=${token}`, headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  const body = resp.json() as { is_owner?: boolean; share_mode?: string };
  assert.equal(body.is_owner, true);
  assert.equal(body.share_mode, 'read_only');
  await app.close();
});

test('GET /api/pdfs/:id marks an anonymous read-only share visitor as is_owner=false', async () => {
  const pdfId = 'detperm-isowner-share-anon-01';
  seedDetailPdf(pdfId, 'private');
  const token = 'detperm-isowner-share-token-02';
  seedShareToken(pdfId, token, 'read_only');
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}?share=${token}` });
  assert.equal(resp.statusCode, 200);
  assert.equal((resp.json() as { is_owner?: boolean }).is_owner, false);
  await app.close();
});
