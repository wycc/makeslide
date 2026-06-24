import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'owner-scorm'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-scorm'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string | null; visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',2,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? 'owner-scorm', opts.visibility ?? 'private', t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,status,image_path,script_path,created_at,updated_at)
     VALUES (?,1,'uid-s1','ready',NULL,NULL,?,?)`,
  ).run(id, t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,status,image_path,script_path,created_at,updated_at)
     VALUES (?,2,'uid-s2','ready',NULL,NULL,?,?)`,
  ).run(id, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /api/pdfs/:id/export.scorm returns 200 with ZIP content-type for owner', async () => {
  const id = `scorm-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/export.scorm`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    assert.ok(
      res.headers['content-type']?.toString().includes('application/zip'),
      `unexpected content-type: ${String(res.headers['content-type'])}`,
    );
    assert.ok(res.headers['content-disposition']?.toString().includes('.scorm.zip'), 'filename should end with .scorm.zip');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/export.scorm returns 200 for public PDF without auth', async () => {
  const id = `scorm-pub-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'public' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/export.scorm` });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.toString().includes('application/zip'));
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/export.scorm returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/pdfs/nonexistent-scorm/export.scorm', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/export.scorm returns 403 for private PDF without auth', async () => {
  const id = `scorm-priv-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/export.scorm` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});
