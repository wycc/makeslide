import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';

setSystemAuthSettings({ googleAuthEnabled: false });

function mockLlmScriptQuality(): void {
  const content = JSON.stringify({ breaks: [] });
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        }),
      },
    },
  } as never);
}

function testSessionCookie(sub = 'owner-squality'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-squality'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string | null; visibility?: string; pageCount?: number } = {}): void {
  const t = nowIso();
  const pageCount = opts.pageCount ?? 3;
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',?,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, pageCount, opts.ownerSub ?? 'owner-squality', opts.visibility ?? 'private', t, t);
  for (let i = 1; i <= pageCount; i++) {
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,status,created_at,updated_at)
       VALUES (?,?,'uid-sq${i}','audio_ready',?,?)`,
    ).run(id, i, t, t);
  }
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /api/pdfs/:id/script-quality returns 200 with contextBreaks array for owner', async () => {
  const id = `sq-${Date.now()}`;
  seedPdf(id);
  mockLlmScriptQuality();
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/script-quality`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    const body = JSON.parse(res.body) as { contextBreaks: unknown[]; analyzedAt: string };
    assert.ok(Array.isArray(body.contextBreaks), 'contextBreaks should be an array');
    assert.ok(typeof body.analyzedAt === 'string', 'analyzedAt should be a string');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/script-quality returns empty array for single-page PDF', async () => {
  const id = `sq-single-${Date.now()}`;
  seedPdf(id, { pageCount: 1 });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/script-quality`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { contextBreaks: unknown[] };
    assert.deepEqual(body.contextBreaks, []);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/script-quality returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/pdfs/nonexistent-sq/script-quality', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/script-quality returns 403 for private PDF without auth', async () => {
  const id = `sq-priv-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/script-quality` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/script-quality returns 200 for public PDF without auth', async () => {
  const id = `sq-pub-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'public' });
  mockLlmScriptQuality();
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/script-quality` });
    assert.equal(res.statusCode, 200);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});
