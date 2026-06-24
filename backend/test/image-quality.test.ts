import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';

setSystemAuthSettings({ googleAuthEnabled: false });

function mockLlmImageQuality(mismatch = false): void {
  const content = JSON.stringify({ mismatch, detail: mismatch ? '圖片與逐字稿主題不符' : '' });
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
      },
    },
  } as never);
}

function testSessionCookie(sub = 'owner-iq'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-iq'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string | null; visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',2,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? 'owner-iq', opts.visibility ?? 'private', t, t);
  for (let i = 1; i <= 2; i++) {
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,status,created_at,updated_at)
       VALUES (?,?,'uid-iq${i}${id}','ready',?,?)`,
    ).run(id, i, t, t);
  }
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /api/pdfs/:id/image-quality returns 200 with empty pages when no images exist', async () => {
  const id = `iq-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/image-quality`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    const body = JSON.parse(res.body) as { pages: unknown[]; analyzedAt: string };
    assert.ok(Array.isArray(body.pages), 'pages should be an array');
    assert.equal(body.pages.length, 0, 'no mismatches when pages have no images');
    assert.ok(typeof body.analyzedAt === 'string');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/image-quality returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/pdfs/nonexistent-iq/image-quality', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/image-quality returns 403 for private PDF without auth', async () => {
  const id = `iq-priv-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/image-quality` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/image-quality returns 200 for public PDF without auth', async () => {
  const id = `iq-pub-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'public' });
  mockLlmImageQuality(false);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/image-quality` });
    assert.equal(res.statusCode, 200);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});
