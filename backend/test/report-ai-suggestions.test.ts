import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'owner-ai'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-ai'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string | null; visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM quiz_attempts WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? 'owner-ai', opts.visibility ?? 'private', t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM quiz_attempts WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

function mockLlm(): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({ suggestions: '## 教學建議\n1. 加強測驗中答錯率高的題目\n2. 重點複習完成率低的頁面' }) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 30, completion_tokens: 40, total_tokens: 70 },
        }),
      },
    },
  } as never);
}

test('POST /api/pdfs/:id/report/ai-suggestions returns suggestions for owner', async () => {
  const id = `ai-sug-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/report/ai-suggestions`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    const body = res.json() as { suggestions: string };
    assert.ok(typeof body.suggestions === 'string' && body.suggestions.length > 0, 'suggestions should be a non-empty string');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('POST /api/pdfs/:id/report/ai-suggestions returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/pdfs/nonexistent-ai-sug/report/ai-suggestions', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('POST /api/pdfs/:id/report/ai-suggestions returns 403 for private PDF without auth', async () => {
  const id = `ai-sug-priv-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/report/ai-suggestions` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});
