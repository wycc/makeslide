import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function ownerHeaders(sub: string) {
  return { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(sub))}` };
}

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, ownerSub: string, visibility = 'private'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, ownerSub, visibility, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('PATCH /api/pdfs/:id/description updates description and returns 200', async () => {
  const id = `desc-test-${Date.now()}`;
  seedPdf(id, 'owner-desc');
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${id}/description`,
      headers: ownerHeaders('owner-desc'),
      payload: { description: '這是一份物理期末考試的簡報備註。' },
    });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body}`);
    const body = JSON.parse(res.body) as { id: string; description: string; updated_at: string };
    assert.equal(body.id, id);
    assert.equal(body.description, '這是一份物理期末考試的簡報備註。');

    const row = db.prepare(`SELECT description FROM pdfs WHERE id = ?`).get(id) as { description: string } | undefined;
    assert.equal(row?.description, '這是一份物理期末考試的簡報備註。');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('PATCH /api/pdfs/:id/description returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/pdfs/nonexistent-desc/description',
      headers: ownerHeaders('owner-desc'),
      payload: { description: 'test' },
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('PATCH /api/pdfs/:id/description returns 403 for non-owner', async () => {
  const id = `desc-403-${Date.now()}`;
  seedPdf(id, 'owner-desc');
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${id}/description`,
      headers: ownerHeaders('other-user'),
      payload: { description: 'hacked' },
    });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id includes description in detail response', async () => {
  const id = `desc-detail-${Date.now()}`;
  seedPdf(id, 'owner-desc');
  const app = await buildApp();
  try {
    await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${id}/description`,
      headers: ownerHeaders('owner-desc'),
      payload: { description: '這是備註內容。' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${id}`,
      headers: ownerHeaders('owner-desc'),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { description?: string };
    assert.equal(body.description, '這是備註內容。');
  } finally {
    cleanup(id);
    await app.close();
  }
});
