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
const OTHER_MULTIPART_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}`, 'content-type': 'multipart/form-data; boundary=----perm' };
const MINIMAL_MULTIPART_PAYLOAD =
  '------perm\r\n' +
  'Content-Disposition: form-data; name="file"; filename="x.png"\r\n' +
  'Content-Type: image/png\r\n\r\n' +
  'x\r\n' +
  '------perm--\r\n';

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedPageOpsPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable', pageCount = 2): void {
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
    const uid = `permuid${i}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, i, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${uid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
    fs.writeFileSync(path.join(pagesDir, `${uid}.text.txt`), `text ${i}`, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), `script ${i}`, 'utf8');
  }
}

async function expectForbidden(method: 'POST' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) {
  const app = await buildApp();
  const resp = await app.inject({ method, url, headers, ...(payload !== undefined ? { payload } : {}) });
  assert.equal(resp.statusCode, 403, `${method} ${url} expected 403, got ${resp.statusCode}: ${resp.body}`);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
}

test('POST /pages rejects a non-owner request on a read-only shared presentation', async () => {
  seedPageOpsPdf('pageops-add-01', 'public');
  await expectForbidden('POST', '/api/pdfs/pageops-add-01/pages', OTHER_HEADERS, { after_page_number: 0 });
});

test('POST /pages allows the owner to add a slide', async () => {
  seedPageOpsPdf('pageops-add-owner-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/pageops-add-owner-01/pages',
    headers: OWNER_HEADERS,
    payload: { after_page_number: 0 },
  });
  assert.equal(resp.statusCode, 201);
  await app.close();
});

test('POST /pages/move rejects a non-owner request on a read-only shared presentation', async () => {
  seedPageOpsPdf('pageops-move-01', 'public');
  await expectForbidden('POST', '/api/pdfs/pageops-move-01/pages/move', OTHER_HEADERS, { from_page_number: 1, to_page_number: 2 });
});

test('POST /pages/move allows the owner to reorder slides', async () => {
  seedPageOpsPdf('pageops-move-owner-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/pageops-move-owner-01/pages/move',
    headers: OWNER_HEADERS,
    payload: { from_page_number: 1, to_page_number: 2 },
  });
  assert.equal(resp.statusCode, 200);
  await app.close();
});

test('DELETE /pages/:n rejects a non-owner request on a read-only shared presentation', async () => {
  seedPageOpsPdf('pageops-delete-01', 'public');
  await expectForbidden('DELETE', '/api/pdfs/pageops-delete-01/pages/1', OTHER_HEADERS);
});

test('DELETE /pages/:n allows the owner to delete a slide', async () => {
  seedPageOpsPdf('pageops-delete-owner-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'DELETE',
    url: '/api/pdfs/pageops-delete-owner-01/pages/1',
    headers: OWNER_HEADERS,
  });
  assert.equal(resp.statusCode, 200);
  await app.close();
});

test('POST /pages/:n/replace-image rejects a non-owner request on a read-only shared presentation', async () => {
  seedPageOpsPdf('pageops-replace-01', 'public');
  await expectForbidden('POST', '/api/pdfs/pageops-replace-01/pages/1/replace-image', OTHER_MULTIPART_HEADERS, MINIMAL_MULTIPART_PAYLOAD);
});

test('POST /pages/:n/regenerate-image rejects a non-owner request on a read-only shared presentation', async () => {
  seedPageOpsPdf('pageops-regen-image-01', 'public');
  await expectForbidden('POST', '/api/pdfs/pageops-regen-image-01/pages/1/regenerate-image', OTHER_HEADERS, { prompt: 'make it brighter' });
});

test('POST /pages/:n/inpaint-image rejects a non-owner request on a read-only shared presentation', async () => {
  seedPageOpsPdf('pageops-inpaint-01', 'public');
  await expectForbidden('POST', '/api/pdfs/pageops-inpaint-01/pages/1/inpaint-image', OTHER_MULTIPART_HEADERS, MINIMAL_MULTIPART_PAYLOAD);
});

test('POST /pages/:n/rewrite-script rejects a non-owner request on a read-only shared presentation', async () => {
  seedPageOpsPdf('pageops-rewrite-01', 'public');
  await expectForbidden('POST', '/api/pdfs/pageops-rewrite-01/pages/1/rewrite-script', OTHER_HEADERS, { prompt: 'polish it', script: 'hello' });
});

test('POST /pages/:n/regenerate-audio rejects a non-owner request on a read-only shared presentation', async () => {
  seedPageOpsPdf('pageops-regen-audio-01', 'public');
  await expectForbidden('POST', '/api/pdfs/pageops-regen-audio-01/pages/1/regenerate-audio', OTHER_HEADERS, { script: 'hello world' });
});

test('DELETE /pages/:n/chat-history rejects a non-owner request on a read-only shared presentation', async () => {
  seedPageOpsPdf('pageops-chat-history-01', 'public');
  await expectForbidden('DELETE', '/api/pdfs/pageops-chat-history-01/pages/1/chat-history', OTHER_HEADERS);
});

test('DELETE /pages/:n/chat-history allows the owner to clear chat history', async () => {
  seedPageOpsPdf('pageops-chat-history-owner-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'DELETE',
    url: '/api/pdfs/pageops-chat-history-owner-01/pages/1/chat-history',
    headers: OWNER_HEADERS,
  });
  assert.equal(resp.statusCode, 204);
  await app.close();
});

test('POST /pages/:n/chat rejects a non-owner request on a read-only shared presentation', async () => {
  seedPageOpsPdf('pageops-chat-01', 'public');
  await expectForbidden('POST', '/api/pdfs/pageops-chat-01/pages/1/chat', OTHER_HEADERS, { question: 'what is this slide about?' });
});

test('all gated routes allow a read-write collaborator on a public_editable presentation', async () => {
  seedPageOpsPdf('pageops-editable-01', 'public_editable');
  const app = await buildApp();

  const moveResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/pageops-editable-01/pages/move',
    headers: OTHER_HEADERS,
    payload: { from_page_number: 1, to_page_number: 2 },
  });
  assert.equal(moveResp.statusCode, 200);

  const chatHistoryResp = await app.inject({
    method: 'DELETE',
    url: '/api/pdfs/pageops-editable-01/pages/1/chat-history',
    headers: OTHER_HEADERS,
  });
  assert.equal(chatHistoryResp.statusCode, 204);

  await app.close();
});
