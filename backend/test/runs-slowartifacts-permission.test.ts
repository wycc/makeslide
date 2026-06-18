import test from 'node:test';
import assert from 'node:assert/strict';
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

function seedPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, visibility, t, t);
}

function seedShareToken(pdfId: string, token: string, access: 'read_only' | 'editable' = 'read_only'): void {
  const t = nowIso();
  db.prepare(`INSERT INTO pdf_shares (pdf_id, token, access, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(pdfId, token, access, t, t);
}

const ROUTES = [
  { path: 'runs', alias: 'runs' },
  { path: 'slow-artifacts', alias: 'slowart' },
] as const;

for (const { path: routeName, alias } of ROUTES) {
  test(`GET /api/pdfs/:id/${routeName} rejects a non-owner request on a private presentation`, async () => {
    const pdfId = `perm-priv-${alias}-01`;
    seedPdf(pdfId, 'private');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/${routeName}`, headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 403);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
    await app.close();
  });

  test(`GET /api/pdfs/:id/${routeName} allows the owner to read it`, async () => {
    const pdfId = `perm-own-${alias}-01`;
    seedPdf(pdfId, 'private');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/${routeName}`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    await app.close();
  });

  test(`GET /api/pdfs/:id/${routeName} allows anyone on a public_editable presentation`, async () => {
    const pdfId = `perm-edit-${alias}-01`;
    seedPdf(pdfId, 'public_editable');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/${routeName}`, headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 200);
    await app.close();
  });

  test(`GET /api/pdfs/:id/${routeName} allows a valid read-only share token without a session`, async () => {
    const pdfId = `perm-share-${alias}-01`;
    seedPdf(pdfId, 'private');
    const token = `token-${alias}-share-01`;
    seedShareToken(pdfId, token, 'read_only');
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/${routeName}?share=${token}` });
    assert.equal(resp.statusCode, 200);
    await app.close();
  });
}
