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

function seedPdf(id: string, ownerSub: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,'private',?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, ownerSub, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM sync_attendees WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /api/pdfs/:id/sync/attendees returns 200 with empty list for owner', async () => {
  const id = `attend-test-${Date.now()}`;
  seedPdf(id, 'owner-attend');
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${id}/sync/attendees`,
      headers: ownerHeaders('owner-attend'),
    });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body}`);
    const body = JSON.parse(res.body) as { attendees: unknown[] };
    assert.ok(Array.isArray(body.attendees));
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/sync/attendees returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/pdfs/nonexistent-attend/sync/attendees',
      headers: ownerHeaders('owner-attend'),
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/sync/attendees returns 403 for non-owner', async () => {
  const id = `attend-403-${Date.now()}`;
  seedPdf(id, 'owner-attend');
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${id}/sync/attendees`,
      headers: ownerHeaders('other-user'),
    });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/sync/attendees includes seeded records', async () => {
  const id = `attend-list-${Date.now()}`;
  seedPdf(id, 'owner-attend');
  const t = nowIso();
  db.prepare(`INSERT INTO sync_attendees (pdf_id, client_id, user_code, joined_at) VALUES (?, ?, ?, ?)`)
    .run(id, 'client-abc', 'Alice', t);
  db.prepare(`INSERT INTO sync_attendees (pdf_id, client_id, user_code, joined_at) VALUES (?, ?, ?, ?)`)
    .run(id, 'client-def', null, t);
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${id}/sync/attendees`,
      headers: ownerHeaders('owner-attend'),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { attendees: Array<{ client_id: string; user_code: string | null; joined_at: string }> };
    assert.equal(body.attendees.length, 2);
    const alice = body.attendees.find((a) => a.client_id === 'client-abc');
    assert.ok(alice, 'Alice should be in attendees');
    assert.equal(alice?.user_code, 'Alice');
  } finally {
    cleanup(id);
    await app.close();
  }
});
