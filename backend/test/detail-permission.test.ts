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
