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

function seedDeletePdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, visibility, t, t);
  fs.mkdirSync(path.join(config.storageRoot, pdfId), { recursive: true });
}

test('DELETE /api/pdfs/:id rejects a non-owner request on a read-only shared presentation', async () => {
  seedDeletePdf('delete-perm-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({ method: 'DELETE', url: '/api/pdfs/delete-perm-readonly-01', headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get('delete-perm-readonly-01');
  assert.notEqual(row, undefined);
  await app.close();
});

test('DELETE /api/pdfs/:id rejects a non-owner request on a private presentation', async () => {
  seedDeletePdf('delete-perm-private-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({ method: 'DELETE', url: '/api/pdfs/delete-perm-private-01', headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('DELETE /api/pdfs/:id allows the owner to delete their presentation', async () => {
  seedDeletePdf('delete-perm-owner-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({ method: 'DELETE', url: '/api/pdfs/delete-perm-owner-01', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 204);
  const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get('delete-perm-owner-01');
  assert.equal(row, undefined);
  await app.close();
});

test('DELETE /api/pdfs/:id allows a read-write collaborator on a public_editable presentation', async () => {
  seedDeletePdf('delete-perm-editable-01', 'public_editable');
  const app = await buildApp();
  const resp = await app.inject({ method: 'DELETE', url: '/api/pdfs/delete-perm-editable-01', headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 204);
  await app.close();
});

test('DELETE /api/pdfs/:id rejects a fully anonymous request (no session cookie) on a public_editable presentation', async () => {
  seedDeletePdf('delete-perm-editable-anon-01', 'public_editable');
  const app = await buildApp();
  // No `headers` at all: a visitor who never logged in and holds no share token,
  // just knows the pdf id. `public_editable` is meant to let signed-in collaborators
  // edit content, not let anonymous requests destroy the whole presentation.
  const resp = await app.inject({ method: 'DELETE', url: '/api/pdfs/delete-perm-editable-anon-01' });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get('delete-perm-editable-anon-01');
  assert.notEqual(row, undefined);
  await app.close();
});
