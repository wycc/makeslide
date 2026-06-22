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
const OWNER_HEADERS_NO_BODY = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}` };
const OTHER_HEADERS_NO_BODY = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}` };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedRegeneratePdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable', pageCount = 2): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, pageCount, visibility, t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (let i = 1; i <= pageCount; i++) {
    const p = String(i).padStart(3, '0');
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, i, `pages/${p}.png`, `pages/${p}.text.txt`, `pages/${p}.script.txt`, `pages/${p}.mp3`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${p}.png`), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(pagesDir, `${p}.text.txt`), `text-${i}`, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${p}.script.txt`), `script-${i}`, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${p}.mp3`), Buffer.from([0x49, 0x44, 0x33]));
  }
}

test('POST /regenerate rejects a non-owner request on a read-only shared presentation', async () => {
  seedRegeneratePdf('regen-perm-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/regen-perm-readonly-01/regenerate',
    headers: OTHER_HEADERS,
    payload: { scripts: { prompt: 'rewrite brief' } },
  });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  const job = db.prepare(`SELECT job_id FROM regenerate_jobs WHERE pdf_id = ?`).get('regen-perm-readonly-01');
  assert.equal(job, undefined);
  await app.close();
});

test('POST /regenerate allows the owner to start a job', async () => {
  seedRegeneratePdf('regen-perm-owner-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/regen-perm-owner-01/regenerate',
    headers: OWNER_HEADERS,
    payload: { scripts: { prompt: 'rewrite brief' } },
  });
  assert.equal(resp.statusCode, 202);
  await app.close();
});

test('POST /regenerate allows a read-write collaborator on a public_editable presentation', async () => {
  seedRegeneratePdf('regen-perm-editable-01', 'public_editable');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/regen-perm-editable-01/regenerate',
    headers: OTHER_HEADERS,
    payload: { scripts: { prompt: 'rewrite brief' } },
  });
  assert.equal(resp.statusCode, 202);
  await app.close();
});

test('POST /regenerate/cancel rejects a non-owner request on a read-only shared presentation', async () => {
  seedRegeneratePdf('regen-perm-cancel-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/regen-perm-cancel-readonly-01/regenerate/cancel',
    headers: OTHER_HEADERS_NO_BODY,
  });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('POST /regenerate/rollback rejects a non-owner request on a read-only shared presentation', async () => {
  seedRegeneratePdf('regen-perm-rollback-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/regen-perm-rollback-readonly-01/regenerate/rollback',
    headers: OTHER_HEADERS_NO_BODY,
  });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('GET /regenerate/status rejects a fully anonymous request on a private presentation', async () => {
  seedRegeneratePdf('regen-perm-status-private-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/regen-perm-status-private-01/regenerate/status',
    // No headers at all: no session cookie, no share token.
  });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('GET /regenerate/status rejects a non-owner request on a private presentation', async () => {
  seedRegeneratePdf('regen-perm-status-private-02', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/regen-perm-status-private-02/regenerate/status',
    headers: OTHER_HEADERS_NO_BODY,
  });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('GET /regenerate/status allows the owner to read job status on a private presentation', async () => {
  seedRegeneratePdf('regen-perm-status-owner-01', 'private');
  const app = await buildApp();
  const startResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/regen-perm-status-owner-01/regenerate',
    headers: OWNER_HEADERS,
    payload: { scripts: { prompt: 'rewrite brief' } },
  });
  assert.equal(startResp.statusCode, 202);

  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/regen-perm-status-owner-01/regenerate/status',
    headers: OWNER_HEADERS_NO_BODY,
  });
  assert.equal(resp.statusCode, 200);
  assert.equal(resp.json().pdf_id, 'regen-perm-status-owner-01');
  await app.close();
});

test('GET /regenerate/status allows an anonymous viewer on a public presentation', async () => {
  seedRegeneratePdf('regen-perm-status-public-01', 'public');
  const app = await buildApp();
  const startResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/regen-perm-status-public-01/regenerate',
    headers: OWNER_HEADERS,
    payload: { scripts: { prompt: 'rewrite brief' } },
  });
  assert.equal(startResp.statusCode, 202);

  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/regen-perm-status-public-01/regenerate/status',
    // No headers: a public presentation's status should still be readable anonymously.
  });
  assert.equal(resp.statusCode, 200);
  assert.equal(resp.json().pdf_id, 'regen-perm-status-public-01');
  await app.close();
});

test('GET /regenerate/status returns 404 (not 403) for an unknown presentation even when anonymous', async () => {
  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/regen-perm-status-missing-01/regenerate/status',
  });
  assert.equal(resp.statusCode, 404);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');
  await app.close();
});

test('POST /regenerate/cancel and /rollback return 404 (not 403) for an unknown presentation', async () => {
  const app = await buildApp();
  const cancelResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/regen-perm-missing-01/regenerate/cancel',
    headers: OWNER_HEADERS_NO_BODY,
  });
  assert.equal(cancelResp.statusCode, 404);
  assert.equal((cancelResp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');

  const rollbackResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/regen-perm-missing-01/regenerate/rollback',
    headers: OWNER_HEADERS_NO_BODY,
  });
  assert.equal(rollbackResp.statusCode, 404);
  assert.equal((rollbackResp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');

  await app.close();
});
