import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'owner-poll'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-poll'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string; visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? 'owner-poll', opts.visibility ?? 'private', t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,status,script_path,text_path,created_at,updated_at)
     VALUES (?,1,'uid-gpoll-?','ready',NULL,NULL,?,?)`,
  ).run(id, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

function mockLlm(): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({ question: '這頁的主要概念是什麼？', options: ['概念A', '概念B', '概念C'] }) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
        }),
      },
    },
  } as never);
}

test('POST /api/pdfs/:id/pages/:n/generate-poll returns draft question for owner', async () => {
  const id = `gpoll-200-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/pages/1/generate-poll`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    const body = res.json() as { question: string; options: string[] };
    assert.ok(typeof body.question === 'string' && body.question.length > 0, 'question should be non-empty');
    assert.ok(Array.isArray(body.options) && body.options.length >= 2, 'options should have at least 2 items');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('POST /api/pdfs/:id/pages/:n/generate-poll returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/pdfs/nonexistent-gpoll/pages/1/generate-poll', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('POST /api/pdfs/:id/pages/:n/generate-poll returns 403 for non-owner', async () => {
  const id = `gpoll-403-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/pages/1/generate-poll`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('POST /api/pdfs/:id/pages/:n/generate-poll returns 404 for unknown page', async () => {
  const id = `gpoll-404pg-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/pages/99/generate-poll`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});
