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

function seedPdf(id: string, ownerSub: string, visibility = 'private', tags = ''): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,tags,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, ownerSub, visibility, tags, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('PATCH /api/pdfs/:id/tags updates tags and returns 200', async () => {
  const id = `tags-test-${Date.now()}`;
  seedPdf(id, 'owner-tags');
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${id}/tags`,
      headers: ownerHeaders('owner-tags'),
      payload: { tags: '物理, 高中, 期末' },
    });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body}`);
    const body = JSON.parse(res.body) as { id: string; tags: string; updated_at: string };
    assert.equal(body.id, id);
    assert.equal(body.tags, '物理, 高中, 期末');

    const row = db.prepare(`SELECT tags FROM pdfs WHERE id = ?`).get(id) as { tags: string } | undefined;
    assert.equal(row?.tags, '物理, 高中, 期末');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('PATCH /api/pdfs/:id/tags returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/pdfs/nonexistent-tags/tags',
      headers: ownerHeaders('owner-tags'),
      payload: { tags: 'test' },
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('PATCH /api/pdfs/:id/tags returns 403 for non-owner', async () => {
  const id = `tags-403-${Date.now()}`;
  seedPdf(id, 'owner-tags');
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${id}/tags`,
      headers: ownerHeaders('other-user'),
      payload: { tags: 'hacked' },
    });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs includes tags in list response', async () => {
  const id = `tags-list-${Date.now()}`;
  seedPdf(id, 'owner-tags', 'private', 'math, exam');
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/pdfs',
      headers: ownerHeaders('owner-tags'),
    });
    assert.equal(res.statusCode, 200);
    const items = JSON.parse(res.body) as Array<{ id: string; tags?: string }>;
    const item = items.find((p) => p.id === id);
    assert.ok(item, 'PDF should appear in list');
    assert.equal(item?.tags, 'math, exam');
  } finally {
    cleanup(id);
    await app.close();
  }
});
