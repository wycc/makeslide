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

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable', status: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,?,1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, status, visibility, t, t);
  const dir = path.join(config.storageRoot, pdfId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
    id: pdfId, title: 't', original_filename: `${pdfId}.pdf`, status, page_count: 1,
    progress_step: null, progress_current: null, progress_total: null, error_message: null,
    pages: [], created_at: t, updated_at: t,
  }), 'utf8');
}

// --- POST /confirm-script ---

test('POST /confirm-script rejects a non-owner request on a read-only shared presentation', async () => {
  seedPdf('uppc-confirm-ro-01', 'public', 'awaiting_script_confirmation');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/uppc-confirm-ro-01/confirm-script', headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('POST /confirm-script allows the owner', async () => {
  seedPdf('uppc-confirm-own-01', 'private', 'awaiting_script_confirmation');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/uppc-confirm-own-01/confirm-script', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 202);
  await app.close();
});

// --- POST /retry ---

test('POST /retry rejects a non-owner request on a read-only shared presentation', async () => {
  seedPdf('uppc-retry-ro-01', 'public', 'failed');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/uppc-retry-ro-01/retry', headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('POST /retry allows the owner', async () => {
  seedPdf('uppc-retry-own-01', 'private', 'failed');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/uppc-retry-own-01/retry', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 202);
  await app.close();
});

// --- POST /generate-video ---

test('POST /generate-video rejects a non-owner request on a read-only shared presentation', async () => {
  seedPdf('uppc-video-ro-01', 'public', 'ready');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/uppc-video-ro-01/generate-video', headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('POST /generate-video lets the owner past the permission check', async () => {
  seedPdf('uppc-video-own-01', 'private', 'ready');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/uppc-video-own-01/generate-video', headers: OWNER_HEADERS });
  // page_count is set but no page rows exist, so this fails past the permission check
  // with INVALID_STATE/NO_AUDIO_PAGES rather than 403 — proving the gate itself works.
  assert.notEqual(resp.statusCode, 403);
  await app.close();
});

// --- POST /duplicate ---

test('POST /duplicate rejects a non-owner request on a private presentation', async () => {
  seedPdf('uppc-dup-priv-01', 'private', 'ready');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/uppc-dup-priv-01/duplicate', headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  const count = db.prepare(`SELECT COUNT(*) AS c FROM pdfs WHERE original_filename LIKE '%uppc-dup-priv-01%' OR title LIKE '%uppc-dup-priv-01%'`).get() as { c: number };
  assert.equal(count.c, 1); // only the original, no duplicate was created
  await app.close();
});

test('POST /duplicate rejects an unauthenticated request on a private presentation', async () => {
  seedPdf('uppc-dup-anon-01', 'private', 'ready');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/uppc-dup-anon-01/duplicate' });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('POST /duplicate allows the owner', async () => {
  seedPdf('uppc-dup-own-01', 'private', 'ready');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/uppc-dup-own-01/duplicate', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 201);
  await app.close();
});

test('POST /duplicate allows anyone to copy a public presentation', async () => {
  seedPdf('uppc-dup-pub-01', 'public', 'ready');
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/uppc-dup-pub-01/duplicate', headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 201);
  await app.close();
});

test('POST /duplicate returns 404 for a non-existent PDF', async () => {
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: '/api/pdfs/uppc-dup-missing/duplicate', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 404);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');
  await app.close();
});
