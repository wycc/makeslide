import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'csv-owner'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('csv-owner'))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('csv-other'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM quiz_attempts WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,'csv-owner','private',?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, t, t);
}

test('GET /api/pdfs/:id/report/students.csv — 200 returns CSV for owner', async () => {
  const id = `csv-test-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/report/students.csv`, headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 200);
  assert.ok(resp.headers['content-type']?.toString().includes('text/csv'));
  assert.ok(resp.body.includes('student_id,attempt_id,quiz_title'));
  await app.close();
});

test('GET /api/pdfs/:id/report/students.csv — 403 for non-owner', async () => {
  const id = `csv-test-403-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/report/students.csv`, headers: OTHER_HEADERS });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('GET /api/pdfs/:id/report/students.csv — 404 for unknown pdf', async () => {
  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: '/api/pdfs/no-such-pdf/report/students.csv', headers: OWNER_HEADERS });
  assert.equal(resp.statusCode, 404);
  await app.close();
});
