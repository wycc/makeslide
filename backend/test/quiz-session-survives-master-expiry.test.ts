import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import crypto from 'node:crypto';

/**
 * 「學生離開後回不到測驗中」（使用者回報，2026-11-02）。實際發生的事：老師把分頁切到別份簡報後
 * master 租約（10 分鐘）到期，getSession() 便 resetSyncMode()，把 quiz_mode／active_quiz_id／
 * quiz_session_id／quizProgress 全部清掉——還在作答的學生被強制交卷（有人交出空白卷）、要回來的
 * 學生 share-join 吃 409、老師的「測驗中的學員」也變空。這一組測試釘住：測驗進行中，這些都不該發生。
 */
function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function seedSyncPdf(pdfId: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, t, t);
}

type App = Awaited<ReturnType<typeof buildApp>>;

async function startQuiz(app: App, pdfId: string, quizId: number): Promise<void> {
  const join = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/join`, headers: OWNER_HEADERS, payload: { client_id: 'master-1' } });
  assert.equal(join.statusCode, 200);
  const start = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${pdfId}/sync/state`,
    headers: OWNER_HEADERS,
    payload: { client_id: 'master-1', page_number: 1, is_playing: false, current_time: 0, quiz_mode: true, active_quiz_id: quizId, quiz_show_answers: false, quiz_session_reset: true },
  });
  assert.equal(start.statusCode, 200);
}

async function session(pdfId: string) {
  const { __getSyncSessionForTest } = await import('../src/routes/pdfs/sync');
  const s = __getSyncSessionForTest(pdfId);
  assert.ok(s, 'in-memory session must exist');
  return s!;
}

function studentState(app: App, pdfId: string, clientId: string) {
  return app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/sync/state?client_id=${clientId}` });
}

test('an expired master lease no longer tears down a quiz in progress', async () => {
  const pdfId = 'quiz-expiry-keep-01';
  seedSyncPdf(pdfId);
  const app = await buildApp();
  try {
    await startQuiz(app, pdfId, 11);
    await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/quiz/progress`,
      payload: { client_id: 'student-1', quiz_id: 11, answered_count: 3, total_questions: 5 },
    });
    const s = await session(pdfId);
    const quizSessionId = s.quizSessionId;
    assert.ok(quizSessionId, 'the quiz has a session id to keep');

    // 老師的分頁被凍結／切去別份簡報：租約過期。
    s.masterExpiresAt = Date.now() - 1000;

    const state = await studentState(app, pdfId, 'student-1');
    assert.equal(state.statusCode, 200);
    const body = state.json() as { quiz_mode: boolean; active_quiz_id: number | null; quiz_session_id: string | null; quiz_progress: unknown[] };
    assert.equal(body.quiz_mode, true, 'the quiz must still be running');
    assert.equal(body.active_quiz_id, 11);
    assert.equal(body.quiz_session_id, quizSessionId, 'a new session id would change every student sessionKey and bounce them to the rules page');
    assert.equal(body.quiz_progress.length, 1, 'the teacher must still see the student (and be able to grant re-entry)');
  } finally {
    await app.close();
  }
});

test('a student can re-join while the quiz runs, even with the master lease expired', async () => {
  const pdfId = 'quiz-expiry-rejoin-01';
  seedSyncPdf(pdfId);
  const app = await buildApp();
  try {
    await startQuiz(app, pdfId, 12);
    const s = await session(pdfId);
    s.masterExpiresAt = Date.now() - 1000;

    const rejoin = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/share-join`, headers: OWNER_HEADERS, payload: { client_id: 'student-back-1' } });
    assert.equal(rejoin.statusCode, 200, 'this 409 was exactly what stranded students outside their own quiz');
    assert.equal((rejoin.json() as { role: string }).role, 'follower');
  } finally {
    await app.close();
  }
});

test('with no quiz running, an expired lease still ends the session and refuses joins', async () => {
  const pdfId = 'quiz-expiry-nonquiz-01';
  seedSyncPdf(pdfId);
  const app = await buildApp();
  try {
    const join = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/join`, headers: OWNER_HEADERS, payload: { client_id: 'master-1' } });
    assert.equal(join.statusCode, 200);
    const s = await session(pdfId);
    s.masterExpiresAt = Date.now() - 1000;

    const rejoin = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/share-join`, headers: OWNER_HEADERS, payload: { client_id: 'viewer-1' } });
    assert.equal(rejoin.statusCode, 409, 'outside a quiz, a dead master still means "no sync session"');
    assert.equal(s.masterClientId, null, 'and the session is reset as before');
  } finally {
    await app.close();
  }
});

test("the owner's polling revives an already-expired lease", async () => {
  const pdfId = 'quiz-expiry-revive-01';
  seedSyncPdf(pdfId);
  const app = await buildApp();
  try {
    await startQuiz(app, pdfId, 13);
    const s = await session(pdfId);
    s.masterExpiresAt = Date.now() - 1000;

    const polled = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/sync/state?client_id=master-1`, headers: OWNER_HEADERS });
    assert.equal(polled.statusCode, 200);
    assert.ok(s.masterExpiresAt > Date.now(), 'the teacher resuming polling is enough — no action needed');
    assert.equal((polled.json() as { role: string }).role, 'master');

    // 學生的輪詢不會幫老師續約（否則任何觀眾都能讓一個已經離開的 master 永遠活著）。
    s.masterExpiresAt = Date.now() - 1000;
    await studentState(app, pdfId, 'student-1');
    assert.ok(s.masterExpiresAt < Date.now(), 'a follower poll must not renew the master lease');
  } finally {
    await app.close();
  }
});

test('a projection-page heartbeat (no quiz_mode) cannot clear a running quiz', async () => {
  const pdfId = 'quiz-heartbeat-01';
  seedSyncPdf(pdfId);
  const app = await buildApp();
  try {
    await startQuiz(app, pdfId, 14);
    const s = await session(pdfId);
    const quizSessionId = s.quizSessionId;

    // PlayPage 的心跳：借用 active_quiz_id 載「正在顯示的投票 id」（通常是 null），不帶 quiz_mode。
    const beat = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/state`,
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-play-1', page_number: 3, is_playing: true, current_time: 1, active_quiz_id: null, quiz_show_answers: false },
    });
    assert.equal(beat.statusCode, 200);
    assert.equal(s.quizMode, true, 'the projection tab must not end the quiz');
    assert.equal(s.activeQuizId, 14);
    assert.equal(s.quizSessionId, quizSessionId, 'nor restart the session');
    assert.equal(s.pageNumber, 3, 'its playback state still applies');

    // 測驗頁明確送 quiz_mode 時照常生效（老師結束測驗）。
    const end = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/state`,
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-1', page_number: 1, is_playing: false, current_time: 0, quiz_mode: false, active_quiz_id: null, quiz_show_answers: false },
    });
    assert.equal(end.statusCode, 200);
    assert.equal(s.quizMode, false);
    assert.equal(s.activeQuizId, null);

    // 測驗結束後，投票 id 又能照舊透過同一個欄位同步。
    await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/state`,
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-play-1', page_number: 3, is_playing: false, current_time: 0, active_quiz_id: 77, quiz_show_answers: true },
    });
    assert.equal(s.activeQuizId, 77, 'polls keep working outside a quiz');
    assert.equal(s.quizShowAnswers, true);
  } finally {
    await app.close();
  }
});
