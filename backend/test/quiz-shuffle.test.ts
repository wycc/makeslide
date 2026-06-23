import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import crypto from 'node:crypto';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(pdfId: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, t, t);
}

function minimalQuestion(id: string) {
  return { id, type: 'single', question: `Q${id}?`, options: [{ text: 'A' }, { text: 'B' }], answer_indices: [0], explanation: '' };
}

test('POST /quizzes saves shuffle_questions=true and GET returns it', async () => {
  seedPdf('quiz-shuffle-01');
  const app = await buildApp();

  const createResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-shuffle-01/quizzes',
    headers: OWNER_HEADERS,
    payload: { title: 'Shuffle Test', prompt: '', questions: [minimalQuestion('q1')], shuffle_questions: true },
  });
  assert.equal(createResp.statusCode, 201);
  const created = createResp.json() as { id: number; shuffle_questions: boolean };
  assert.equal(created.shuffle_questions, true, 'created quiz should have shuffle_questions=true');

  const listResp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/quiz-shuffle-01/quizzes',
    headers: OWNER_HEADERS,
  });
  assert.equal(listResp.statusCode, 200);
  const list = listResp.json() as { quizzes: Array<{ id: number; shuffle_questions: boolean }> };
  const found = list.quizzes.find((q) => q.id === created.id);
  assert.ok(found, 'quiz should appear in list');
  assert.equal(found.shuffle_questions, true, 'listed quiz should have shuffle_questions=true');

  await app.close();
});

test('PUT /quizzes/:id toggles shuffle_questions from true to false', async () => {
  seedPdf('quiz-shuffle-02');
  const app = await buildApp();

  const createResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-shuffle-02/quizzes',
    headers: OWNER_HEADERS,
    payload: { title: 'Toggle Test', prompt: '', questions: [minimalQuestion('q1')], shuffle_questions: true },
  });
  assert.equal(createResp.statusCode, 201);
  const created = createResp.json() as { id: number };

  const updateResp = await app.inject({
    method: 'PUT',
    url: `/api/pdfs/quiz-shuffle-02/quizzes/${created.id}`,
    headers: OWNER_HEADERS,
    payload: { title: 'Toggle Test', prompt: '', questions: [minimalQuestion('q1')], shuffle_questions: false },
  });
  assert.equal(updateResp.statusCode, 200);
  const updated = updateResp.json() as { shuffle_questions: boolean };
  assert.equal(updated.shuffle_questions, false, 'shuffle_questions should be false after update');

  await app.close();
});

test('POST /quizzes defaults shuffle_questions to false when omitted', async () => {
  seedPdf('quiz-shuffle-03');
  const app = await buildApp();

  const createResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-shuffle-03/quizzes',
    headers: OWNER_HEADERS,
    payload: { title: 'Default Test', prompt: '', questions: [minimalQuestion('q1')] },
  });
  assert.equal(createResp.statusCode, 201);
  const created = createResp.json() as { shuffle_questions: boolean };
  assert.equal(created.shuffle_questions, false, 'shuffle_questions should default to false');

  await app.close();
});
