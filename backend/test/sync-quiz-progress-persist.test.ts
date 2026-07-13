import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import crypto from 'node:crypto';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString(
    'base64url',
  );
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedSyncPdf(pdfId: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, t, t);
}

async function startQuiz(app: Awaited<ReturnType<typeof buildApp>>, pdfId: string, quizId: number): Promise<void> {
  const join = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${pdfId}/sync/join`,
    headers: OWNER_HEADERS,
    payload: { client_id: 'master-1' },
  });
  assert.equal(join.statusCode, 200);
  const start = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${pdfId}/sync/state`,
    headers: OWNER_HEADERS,
    payload: {
      client_id: 'master-1',
      page_number: 1,
      is_playing: false,
      current_time: 0,
      quiz_mode: true,
      active_quiz_id: quizId,
      quiz_show_answers: false,
      quiz_session_reset: true,
    },
  });
  assert.equal(start.statusCode, 200);
}

async function reportProgress(app: Awaited<ReturnType<typeof buildApp>>, pdfId: string, clientId: string, quizId: number): Promise<void> {
  const report = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${pdfId}/sync/quiz/progress`,
    payload: { client_id: clientId, quiz_id: quizId, answered_count: 2, total_questions: 5, submitted: false },
  });
  assert.equal(report.statusCode, 200);
}

function masterProgressList(stateBody: string): Array<{ client_id: string }> {
  return (JSON.parse(stateBody) as { quiz_progress: Array<{ client_id: string }> }).quiz_progress;
}

// 學生停止作答（分頁被背景節流、關閉或斷線）超過 30 秒 CLIENT_TTL_MS 後，pruneExpiredClients()
// 原本會連同 quizProgress 一起刪除，使該學生從 master 的作答名單上消失，老師再也看不到、也無法
// 對其按「允許重新進入」。測驗進行中，凡是進入過作答畫面（回報過進度）的學生都必須留在名單上
// 直到測驗結束；進度的生命週期改由「開始／切換測驗、結束測驗」管理。
test('quiz progress survives client TTL expiry while the quiz is active', async () => {
  seedSyncPdf('sync-quizprog-ttl-01');
  const app = await buildApp();
  try {
    await startQuiz(app, 'sync-quizprog-ttl-01', 7);
    await reportProgress(app, 'sync-quizprog-ttl-01', 'student-1', 7);

    const { __getSyncSessionForTest } = await import('../src/routes/pdfs/sync');
    const session = __getSyncSessionForTest('sync-quizprog-ttl-01');
    assert.ok(session, 'in-memory session must exist after the requests above');
    assert.ok(session!.quizProgress.has('student-1'), 'sanity check: progress was recorded');

    // 模擬 30 秒 CLIENT_TTL_MS 過期而學生從未呼叫 /sync/leave（分頁節流／關閉／斷線）。
    session!.clients.set('student-1', Date.now() - 1000);

    const state = await app.inject({
      method: 'GET',
      url: '/api/pdfs/sync-quizprog-ttl-01/sync/state?client_id=master-1',
    });
    assert.equal(state.statusCode, 200);
    assert.equal(session!.clients.has('student-1'), false, 'sanity check: the client TTL bookkeeping itself is pruned');
    assert.deepEqual(
      masterProgressList(state.body).map((p) => p.client_id),
      ['student-1'],
      'the student must stay on the master progress list until the quiz ends',
    );
  } finally {
    await app.close();
  }
});

// 同理，學生端呼叫 /sync/leave（例如關掉同步開關）也不應在測驗進行中把作答進度從名單上移除。
test('quiz progress survives /sync/leave while the quiz is active', async () => {
  seedSyncPdf('sync-quizprog-leave-01');
  const app = await buildApp();
  try {
    await startQuiz(app, 'sync-quizprog-leave-01', 9);
    await reportProgress(app, 'sync-quizprog-leave-01', 'student-1', 9);

    const leave = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-quizprog-leave-01/sync/leave',
      payload: { client_id: 'student-1' },
    });
    assert.equal(leave.statusCode, 200);

    const state = await app.inject({
      method: 'GET',
      url: '/api/pdfs/sync-quizprog-leave-01/sync/state?client_id=master-1',
    });
    assert.equal(state.statusCode, 200);
    assert.deepEqual(
      masterProgressList(state.body).map((p) => p.client_id),
      ['student-1'],
      'leaving the sync session must not drop the student from the quiz progress list mid-quiz',
    );
  } finally {
    await app.close();
  }
});

// 測驗結束（quiz_mode 關閉 → active_quiz_id 變為 null）時進度照常清空，保留的項目不會外洩到下一輪；
// 之後逾時的 client 沒有進行中的測驗，quizProgress 也照原本行為被 prune。
test('quiz progress is still cleared when the quiz ends', async () => {
  seedSyncPdf('sync-quizprog-end-01');
  const app = await buildApp();
  try {
    await startQuiz(app, 'sync-quizprog-end-01', 11);
    await reportProgress(app, 'sync-quizprog-end-01', 'student-1', 11);

    const end = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-quizprog-end-01/sync/state',
      headers: OWNER_HEADERS,
      payload: {
        client_id: 'master-1',
        page_number: 1,
        is_playing: false,
        current_time: 0,
        quiz_mode: false,
        active_quiz_id: null,
        quiz_show_answers: false,
      },
    });
    assert.equal(end.statusCode, 200);

    const { __getSyncSessionForTest } = await import('../src/routes/pdfs/sync');
    const session = __getSyncSessionForTest('sync-quizprog-end-01');
    assert.ok(session, 'in-memory session must exist after the requests above');
    assert.equal(session!.quizProgress.size, 0, 'ending the quiz must clear the retained progress entries');
  } finally {
    await app.close();
  }
});
