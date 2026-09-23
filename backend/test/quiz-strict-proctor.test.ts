import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { mergeQuizLeaves } from '../src/routes/pdfs/sync';
import crypto from 'node:crypto';

/**
 * 防弊可關閉＋離開紀錄（使用者要求，2026-09-22）：測驗多一個 strict_proctor 設定（預設開）；
 * 學生的進度回報可夾帶離開紀錄，老師端的 quiz_progress 列出每次離開的時間與長度。
 */
function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function seedPdf(pdfId: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, t, t);
}

const QUESTION = { id: 'q1', type: 'single', question: 'Q?', options: [{ text: 'A' }, { text: 'B' }], answer_indices: [0], explanation: '' };

test('strict_proctor defaults to on, and can be saved off and back on', async () => {
  seedPdf('quiz-strict-01');
  const app = await buildApp();
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pdfs/quiz-strict-01/quizzes',
      headers: OWNER_HEADERS,
      payload: { title: 'Strict', prompt: '', questions: [QUESTION] },
    });
    assert.equal(created.statusCode, 201);
    const quiz = created.json() as { id: number; strict_proctor: boolean };
    assert.equal(quiz.strict_proctor, true, 'omitted → strict, same as before the option existed');

    const off = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/quiz-strict-01/quizzes/${quiz.id}`,
      headers: OWNER_HEADERS,
      payload: { title: 'Strict', prompt: '', questions: [QUESTION], strict_proctor: false },
    });
    assert.equal(off.statusCode, 200);
    const list = await app.inject({ method: 'GET', url: '/api/pdfs/quiz-strict-01/quizzes', headers: OWNER_HEADERS });
    const listed = (list.json() as { quizzes: Array<{ id: number; strict_proctor: boolean }> }).quizzes.find((q) => q.id === quiz.id);
    assert.equal(listed?.strict_proctor, false, 'students read the quiz from this list, so the flag must be in it');
  } finally {
    await app.close();
  }
});

test('mergeQuizLeaves unions by leave time, fills in the duration later, keeps order', () => {
  const a = { leftAt: '2026-09-22T01:00:00.000Z', awayMs: null };
  const b = { leftAt: '2026-09-22T01:05:00.000Z', awayMs: 3000 };
  assert.deepEqual(mergeQuizLeaves([], [b, a]), [a, b], 'sorted by time');
  assert.deepEqual(
    mergeQuizLeaves([a, b], [{ leftAt: a.leftAt, awayMs: 12000 }]),
    [{ leftAt: a.leftAt, awayMs: 12000 }, b],
    'the return closes the open leave; a partial report (after a reload) does not drop earlier ones',
  );
  assert.deepEqual(mergeQuizLeaves([b], [{ leftAt: b.leftAt, awayMs: null }]), [b], 'a stale open copy does not erase a known duration');
});

test('leaves reported with progress show up on the teacher’s progress list and survive a report without them', async () => {
  const pdfId = 'quiz-strict-leaves-01';
  seedPdf(pdfId);
  const app = await buildApp();
  try {
    const join = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/join`, headers: OWNER_HEADERS, payload: { client_id: 'master-1' } });
    assert.equal(join.statusCode, 200);
    const start = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/state`,
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-1', page_number: 1, is_playing: false, current_time: 0, quiz_mode: true, active_quiz_id: 3, quiz_show_answers: false, quiz_session_reset: true },
    });
    assert.equal(start.statusCode, 200);
    const report = (extra: Record<string, unknown>) => app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/quiz/progress`,
      payload: { client_id: 'student-1', quiz_id: 3, answered_count: 1, total_questions: 4, ...extra },
    });
    assert.equal((await report({ leaves: [{ left_at: '2026-09-22T01:00:00.000Z', away_ms: null }] })).statusCode, 200);
    assert.equal((await report({ leaves: [{ left_at: '2026-09-22T01:00:00.000Z', away_ms: 4200 }] })).statusCode, 200);
    assert.equal((await report({ answered_count: 2 })).statusCode, 200, 'a plain progress report');
    assert.equal((await report({ leaves: [{ left_at: 'yesterday', away_ms: 1 }] })).statusCode, 400, 'timestamps are validated');

    const state = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/sync/state?client_id=master-1` });
    const progress = (state.json() as { quiz_progress: Array<{ client_id: string; answered_count: number; leaves: unknown }> }).quiz_progress;
    const student = progress.find((p) => p.client_id === 'student-1');
    assert.equal(student?.answered_count, 2);
    assert.deepEqual(student?.leaves, [{ left_at: '2026-09-22T01:00:00.000Z', away_ms: 4200 }]);
  } finally {
    await app.close();
  }
});
