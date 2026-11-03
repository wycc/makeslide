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

// 老師端「測驗中的學員」顯示 `code || display_name`，但學生走 share-join 加入、從來沒有機會登記
// 使用者代碼，名單只好顯示 Google 名稱（使用者回報，2026-09-15）。進度回報帶上 user_code 即登記。
test('a progress report carrying user_code makes the master list show the code, and a later report without it keeps it', async () => {
  seedSyncPdf('sync-quizprog-code-01');
  const app = await buildApp();
  try {
    await startQuiz(app, 'sync-quizprog-code-01', 9);
    const withCode = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-quizprog-code-01/sync/quiz/progress',
      payload: { client_id: 'student-c', user_code: 'B1428036', quiz_id: 9, answered_count: 1, total_questions: 5, submitted: false },
    });
    assert.equal(withCode.statusCode, 200, withCode.body);
    // The master's "allow re-entry" report is sent on the student's behalf and carries no code.
    const withoutCode = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-quizprog-code-01/sync/quiz/progress',
      payload: { client_id: 'student-c', quiz_id: 9, answered_count: 1, total_questions: 5, submitted: false, reentry_allowed: true },
    });
    assert.equal(withoutCode.statusCode, 200);
    const state = await app.inject({ method: 'GET', url: '/api/pdfs/sync-quizprog-code-01/sync/state?client_id=master-1' });
    const list = (JSON.parse(state.body) as { quiz_progress: Array<{ client_id: string; code: string | null }> }).quiz_progress;
    assert.deepEqual(list.map((p) => ({ id: p.client_id, code: p.code })), [{ id: 'student-c', code: 'B1428036' }]);
  } finally {
    await app.close();
  }
});

// 使用者回報（2026-10-20）：防弊關掉後學生「出去後進不來」。client_id 存在學生分頁的 sessionStorage，
// 關掉瀏覽器或從 LINE 重開連結就是新的 client_id；老師對舊的那一列按「允許重新進入」，許可只記
// client_id，永遠送不到新的 client。改成連同代碼一起記，並把同代碼的舊列併進新列。
test('reentry granted on the old client reaches a new client with the same code, and the list merges into one row', async () => {
  seedSyncPdf('sync-quizprog-reentry-code-01');
  const pdf = 'sync-quizprog-reentry-code-01';
  const app = await buildApp();
  try {
    await startQuiz(app, pdf, 9);
    // 舊 client 作答中、離開過一次。
    const first = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdf}/sync/quiz/progress`,
      payload: {
        client_id: 'student-old', user_code: 'S01', quiz_id: 9, answered_count: 2, total_questions: 5, submitted: false,
        leaves: [{ left_at: '2026-10-20T01:00:00.000Z', away_ms: 12000 }],
      },
    });
    assert.equal(first.statusCode, 200, first.body);
    // 老師對舊的那一列按「允許重新進入」（老師的瀏覽器代送，不帶代碼）。
    const grant = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdf}/sync/quiz/progress`,
      payload: { client_id: 'student-old', quiz_id: 9, answered_count: 2, total_questions: 5, submitted: false, reentry_allowed: true },
    });
    assert.equal(grant.statusCode, 200);
    // 新 client 還沒回報過進度，只靠輪詢帶上代碼就該拿到許可。
    const pollNew = await app.inject({ method: 'GET', url: `/api/pdfs/${pdf}/sync/state?client_id=student-new&user_code=S01` });
    assert.equal((JSON.parse(pollNew.body) as { quiz_allow_reentry: boolean }).quiz_allow_reentry, true, 'the grant follows the code to the new client');
    const pollStranger = await app.inject({ method: 'GET', url: `/api/pdfs/${pdf}/sync/state?client_id=student-x&user_code=S02` });
    assert.equal((JSON.parse(pollStranger.body) as { quiz_allow_reentry: boolean }).quiz_allow_reentry, false, 'another code is not granted');
    // 新 client（已結束畫面）回報一次進度：名單上只剩一列、是新的 client，離開紀錄與許可都帶過來。
    const second = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdf}/sync/quiz/progress`,
      payload: { client_id: 'student-new', user_code: 'S01', quiz_id: 9, answered_count: 5, total_questions: 5, submitted: true },
    });
    assert.equal(second.statusCode, 200, second.body);
    const state = await app.inject({ method: 'GET', url: `/api/pdfs/${pdf}/sync/state?client_id=master-1` });
    const list = (JSON.parse(state.body) as {
      quiz_progress: Array<{ client_id: string; code: string | null; reentry_allowed: boolean; submitted: boolean; leaves: Array<{ left_at: string }> }>;
    }).quiz_progress;
    assert.deepEqual(list.map((p) => [p.client_id, p.code, p.reentry_allowed, p.submitted]), [['student-new', 'S01', true, true]]);
    assert.deepEqual(list[0]!.leaves.map((l) => l.left_at), ['2026-10-20T01:00:00.000Z'], 'the old row\'s leaves move to the new row');
    // 學生重進後回報 reentry_allowed:false：許可用掉，代碼與 client 都不再被點名。
    const consume = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdf}/sync/quiz/progress`,
      payload: { client_id: 'student-new', user_code: 'S01', quiz_id: 9, answered_count: 5, total_questions: 5, submitted: false, reentry_allowed: false },
    });
    assert.equal(consume.statusCode, 200);
    const after = await app.inject({ method: 'GET', url: `/api/pdfs/${pdf}/sync/state?client_id=student-new` });
    assert.equal((JSON.parse(after.body) as { quiz_allow_reentry: boolean }).quiz_allow_reentry, false);
    const afterOld = await app.inject({ method: 'GET', url: `/api/pdfs/${pdf}/sync/state?client_id=student-old` });
    assert.equal((JSON.parse(afterOld.body) as { quiz_allow_reentry: boolean }).quiz_allow_reentry, true, 'the old client id itself was named directly and keeps its own grant');
  } finally {
    await app.close();
  }
});

// 使用者回報（2026-11-03）：問答題相機打不開的學生要在老師名單上標出來；沒帶欄位的回報維持原值，上傳成功回報 null 清掉。
test('a camera failure is kept on the progress row until the student reports it cleared', async () => {
  seedSyncPdf('sync-quizprog-camera-01');
  const pdf = 'sync-quizprog-camera-01';
  const app = await buildApp();
  try {
    await startQuiz(app, pdf, 9);
    const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/pdfs/${pdf}/sync/quiz/progress`, payload: { client_id: 'student-cam', user_code: 'C01', quiz_id: 9, answered_count: 3, total_questions: 6, submitted: false, ...payload } });
    const row = async () => (JSON.parse((await app.inject({ method: 'GET', url: `/api/pdfs/${pdf}/sync/state?client_id=master-1` })).body) as { quiz_progress: Array<{ camera_error: string | null }> }).quiz_progress[0]!;
    assert.equal((await post({})).statusCode, 200);
    assert.equal((await row()).camera_error, null, 'normal by default');
    assert.equal((await post({ camera_error: 'unsupported' })).statusCode, 200);
    assert.equal((await row()).camera_error, 'unsupported');
    assert.equal((await post({ answered_count: 4 })).statusCode, 200, 'an ordinary progress report');
    assert.equal((await row()).camera_error, 'unsupported', 'does not wipe the flag');
    assert.equal((await post({ camera_error: null })).statusCode, 200);
    assert.equal((await row()).camera_error, null, 'cleared after a successful upload');
    assert.equal((await post({ camera_error: 'bogus' })).statusCode, 400, 'unknown reasons are rejected');
  } finally {
    await app.close();
  }
});
