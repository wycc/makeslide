import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'owner-h5p'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-h5p'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string | null; visibility?: string; pageCount?: number } = {}): void {
  const t = nowIso();
  const pageCount = opts.pageCount ?? 2;
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',?,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, pageCount, opts.ownerSub ?? 'owner-h5p', opts.visibility ?? 'private', t, t);
  for (let i = 1; i <= pageCount; i++) {
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,status,created_at,updated_at)
       VALUES (?,?,'uid-h5p${i}','audio_ready',?,?)`,
    ).run(id, i, t, t);
  }
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /api/pdfs/:id/export.h5p returns 200 ZIP with h5p.json for owner', async () => {
  const id = `h5p-success-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/export.h5p`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    assert.ok(
      res.headers['content-type']?.toString().includes('application/zip'),
      `unexpected content-type: ${String(res.headers['content-type'])}`,
    );
    assert.ok(res.rawPayload.length > 100, 'ZIP payload too small');
    const cd = String(res.headers['content-disposition'] ?? '');
    assert.ok(cd.includes('.h5p'), `content-disposition should reference .h5p: ${cd}`);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/export.h5p returns 200 for public PDF without auth', async () => {
  const id = `h5p-pub-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'public' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/export.h5p` });
    assert.equal(res.statusCode, 200);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/export.h5p returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/pdfs/nonexistent-h5p/export.h5p', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/export.h5p returns 403 for private PDF without auth', async () => {
  const id = `h5p-priv-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/export.h5p` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});
