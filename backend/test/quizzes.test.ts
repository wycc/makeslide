import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import crypto from 'node:crypto';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedQuizPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable' = 'public'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, visibility, t, t);
}

function validQuizPayload() {
  return {
    title: '測驗一',
    prompt: '',
    questions: [
      {
        id: 'q1',
        type: 'single',
        question: '1+1=?',
        options: [{ text: '1' }, { text: '2' }],
        answer_indices: [1],
        explanation: '',
      },
    ],
  };
}

test('POST /quizzes/generate rejects a non-owner request on a read-only shared presentation', async () => {
  seedQuizPdf('quiz-generate-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-generate-readonly-01/quizzes/generate',
    headers: OTHER_HEADERS,
    payload: { prompt: 'make a quiz' },
  });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('POST /quizzes/generate allows the owner past the permission check', async () => {
  seedQuizPdf('quiz-generate-owner-01', 'private');
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: { content: JSON.stringify({ title: '測驗', questions: [{ type: 'single', question: 'Q?', options: ['A', 'B'], answer_indices: [0] }] }) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      },
    },
  } as never);
  try {
    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/quiz-generate-owner-01/quizzes/generate',
      headers: OWNER_HEADERS,
      payload: { prompt: 'make a quiz' },
    });
    assert.equal(resp.statusCode, 200);
    await app.close();
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('POST /quizzes rejects a non-owner request and returns 404 for an unknown presentation', async () => {
  seedQuizPdf('quiz-create-readonly-01', 'public');
  const app = await buildApp();
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-create-readonly-01/quizzes',
    headers: OTHER_HEADERS,
    payload: validQuizPayload(),
  });
  assert.equal(forbidden.statusCode, 403);
  assert.equal((forbidden.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  const count = db.prepare(`SELECT COUNT(*) as c FROM quiz_sets WHERE pdf_id = ?`).get('quiz-create-readonly-01') as { c: number };
  assert.equal(count.c, 0);

  const missing = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-create-missing-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  assert.equal(missing.statusCode, 404);

  await app.close();
});

test('POST /quizzes allows the owner and a read-write collaborator to create a quiz', async () => {
  seedQuizPdf('quiz-create-owner-01', 'private');
  const app = await buildApp();
  const ownerResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-create-owner-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  assert.equal(ownerResp.statusCode, 201);

  seedQuizPdf('quiz-create-editable-01', 'public_editable');
  const editableResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-create-editable-01/quizzes',
    headers: OTHER_HEADERS,
    payload: validQuizPayload(),
  });
  assert.equal(editableResp.statusCode, 201);

  await app.close();
});

test('PUT /quizzes/:quizId rejects a non-owner request and allows the owner', async () => {
  seedQuizPdf('quiz-update-01', 'public');
  const app = await buildApp();
  const createResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-update-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  assert.equal(createResp.statusCode, 201);
  const quizId = (createResp.json() as { id: number }).id;

  const forbidden = await app.inject({
    method: 'PUT',
    url: `/api/pdfs/quiz-update-01/quizzes/${quizId}`,
    headers: OTHER_HEADERS,
    payload: { ...validQuizPayload(), title: '改過的標題' },
  });
  assert.equal(forbidden.statusCode, 403);
  const unchanged = db.prepare(`SELECT title FROM quiz_sets WHERE id = ?`).get(quizId) as { title: string };
  assert.equal(unchanged.title, '測驗一');

  const allowed = await app.inject({
    method: 'PUT',
    url: `/api/pdfs/quiz-update-01/quizzes/${quizId}`,
    headers: OWNER_HEADERS,
    payload: { ...validQuizPayload(), title: '改過的標題' },
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal((allowed.json() as { title: string }).title, '改過的標題');

  await app.close();
});

test('POST /quizzes/:quizId/attempts is not gated by edit permission so followers can submit answers', async () => {
  seedQuizPdf('quiz-attempt-01', 'public');
  const app = await buildApp();
  const createResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-attempt-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  const quizId = (createResp.json() as { id: number }).id;

  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/quiz-attempt-01/quizzes/${quizId}/attempts`,
    headers: OTHER_HEADERS,
    payload: { client_id: 'client-1', session_id: 'session-1', answers: { q1: [1] } },
  });
  assert.equal(resp.statusCode, 201);

  await app.close();
});
