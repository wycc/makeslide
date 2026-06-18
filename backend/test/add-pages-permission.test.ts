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

function seedAddPagesPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable', pageCount = 1): void {
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
    fs.writeFileSync(path.join(pagesDir, `${p}.text.txt`), `text-${i}`, 'utf8');
  }
}

test('POST /add-pages-from-prompt rejects a non-owner request on a read-only shared presentation', async () => {
  seedAddPagesPdf('addpages-perm-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/addpages-perm-readonly-01/add-pages-from-prompt',
    headers: OTHER_HEADERS,
    payload: { prompt: 'add a summary slide' },
  });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('POST /add-pages-from-prompt allows the owner to start a job', async () => {
  seedAddPagesPdf('addpages-perm-owner-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/addpages-perm-owner-01/add-pages-from-prompt',
    headers: OWNER_HEADERS,
    payload: { prompt: 'add a summary slide' },
  });
  assert.equal(resp.statusCode, 202);
  await app.close();
});

test('POST /add-pages-from-prompt allows a read-write collaborator on a public_editable presentation', async () => {
  seedAddPagesPdf('addpages-perm-editable-01', 'public_editable');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/addpages-perm-editable-01/add-pages-from-prompt',
    headers: OTHER_HEADERS,
    payload: { prompt: 'add a summary slide' },
  });
  assert.equal(resp.statusCode, 202);
  await app.close();
});

test('POST /add-pages-from-prompt/cancel rejects a non-owner request on a read-only shared presentation', async () => {
  seedAddPagesPdf('addpages-perm-cancel-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/addpages-perm-cancel-readonly-01/add-pages-from-prompt/cancel',
    headers: OTHER_HEADERS_NO_BODY,
  });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('POST /add-pages-from-prompt/cancel returns 404 (not 403) for an unknown presentation', async () => {
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/addpages-perm-missing-01/add-pages-from-prompt/cancel',
    headers: OWNER_HEADERS_NO_BODY,
  });
  assert.equal(resp.statusCode, 404);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'PDF_NOT_FOUND');
  await app.close();
});

test('POST /add-pages-outline-chat rejects a non-owner request on a read-only shared presentation', async () => {
  seedAddPagesPdf('addpages-perm-outline-ro-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/addpages-perm-outline-ro-01/add-pages-outline-chat',
    headers: OTHER_HEADERS,
    payload: { messages: [{ role: 'user', content: 'add a slide about pricing' }] },
  });
  assert.equal(resp.statusCode, 403);
  await app.close();
});
