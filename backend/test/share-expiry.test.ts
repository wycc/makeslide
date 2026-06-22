import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'owner-share'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-share'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,'owner-share','private',?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('POST /api/pdfs/:id/share with expires_days stores expires_at', async () => {
  const id = `share-expiry-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/share`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      payload: JSON.stringify({ access: 'read_only', expires_days: 7 }),
    });
    assert.equal(resp.statusCode, 200, resp.body.slice(0, 200));
    const body = resp.json() as { token: string; expires_at: string | null };
    assert.ok(body.token, 'should return a token');
    assert.ok(body.expires_at, 'should return expires_at');
    const expiresAt = new Date(body.expires_at!);
    const diff = expiresAt.getTime() - Date.now();
    assert.ok(diff > 6 * 86400000 && diff < 8 * 86400000, `expected ~7 days but got ${diff}ms`);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id with expired share token returns 410', async () => {
  const id = `share-expired-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const token = crypto.randomBytes(18).toString('base64url');
    db.prepare(
      `INSERT INTO pdf_shares (token, pdf_id, access, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    ).run(token, id, 'read_only', pastDate, nowIso(), nowIso());

    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${id}?share=${encodeURIComponent(token)}`,
    });
    assert.equal(resp.statusCode, 410, `expected 410 but got ${resp.statusCode}: ${resp.body.slice(0, 200)}`);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id with valid non-expired share token returns 200', async () => {
  const id = `share-valid-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();
    const token = crypto.randomBytes(18).toString('base64url');
    db.prepare(
      `INSERT INTO pdf_shares (token, pdf_id, access, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    ).run(token, id, 'read_only', futureDate, nowIso(), nowIso());

    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${id}?share=${encodeURIComponent(token)}`,
    });
    assert.equal(resp.statusCode, 200, `expected 200 but got ${resp.statusCode}: ${resp.body.slice(0, 200)}`);
  } finally {
    cleanup(id);
    await app.close();
  }
});
