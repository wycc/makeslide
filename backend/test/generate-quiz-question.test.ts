import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'owner-gqq'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-gqq'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string; visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? 'owner-gqq', opts.visibility ?? 'private', t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,status,script_path,text_path,created_at,updated_at)
     VALUES (?,1,'uid-gqq-1','ready',NULL,NULL,?,?)`,
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
          choices: [{
            message: {
              content: JSON.stringify({
                question: '下列哪一項最能描述本頁主題？',
                options: ['選項A', '選項B', '選項C', '選項D'],
                correct_index: 0,
                explanation: '選項A 是正確答案，因為……',
              }),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 20, completion_tokens: 60, total_tokens: 80 },
        }),
      },
    },
  } as never);
}

test('POST /api/pdfs/:id/pages/:n/generate-quiz-question returns draft for owner', async () => {
  const id = `gqq-200-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/pages/1/generate-quiz-question`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    const body = res.json() as { question: string; options: string[]; correct_index: number; explanation: string };
    assert.ok(typeof body.question === 'string' && body.question.length > 0, 'question should be non-empty');
    assert.equal(body.options.length, 4, 'options should have 4 items');
    assert.ok(body.correct_index >= 0 && body.correct_index <= 3, 'correct_index should be 0-3');
    assert.ok(typeof body.explanation === 'string', 'explanation should be string');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('POST /api/pdfs/:id/pages/:n/generate-quiz-question returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/pdfs/nonexistent-gqq/pages/1/generate-quiz-question', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('POST /api/pdfs/:id/pages/:n/generate-quiz-question returns 403 for non-owner', async () => {
  const id = `gqq-403-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/pages/1/generate-quiz-question`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});
