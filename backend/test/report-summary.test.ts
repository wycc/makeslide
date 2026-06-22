import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

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

function seedReportPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable' = 'private'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',3,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 'Report PDF', `${pdfId}.pdf`, visibility, t, t);
  const insertPage = db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,?,?,?,NULL,NULL,NULL,NULL,'audio_ready',NULL,?,?)`,
  );
  for (const page of [1, 2, 3]) {
    insertPage.run(pdfId, page, `${pdfId}-${page}`, `pages/${pdfId}-${page}.jpg`, t, t);
  }
}

function seedQuizAttempts(pdfId: string): void {
  const t = nowIso();
  const quizId = Number(
    db
      .prepare(`INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, created_at, updated_at) VALUES (?, 'Quiz', '', '[]', ?, ?)`) 
      .run(pdfId, t, t).lastInsertRowid,
  );
  const insertAttempt = db.prepare(
    `INSERT INTO quiz_attempts (pdf_id, quiz_id, session_id, client_id, code, answers_json, score, submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, '{}', ?, ?, ?, ?)`,
  );
  insertAttempt.run(pdfId, quizId, 'session-1', 'student-a', 80, t, t, t);
  insertAttempt.run(pdfId, quizId, 'session-2', 'student-b', 60, t, t, t);
}

function seedPollVotes(pdfId: string): void {
  const t = nowIso();
  const insertPoll = db.prepare(
    `INSERT INTO page_polls (pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at)
     VALUES (?, ?, ?, '["A","B"]', 1, 1, ?, ?)`,
  );
  const poll1 = Number(insertPoll.run(pdfId, 1, 'Poll 1', t, t).lastInsertRowid);
  const poll2 = Number(insertPoll.run(pdfId, 2, 'Poll 2', t, t).lastInsertRowid);
  const insertVote = db.prepare(`INSERT INTO page_poll_votes (poll_id, voter_id, option_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
  insertVote.run(poll1, 'student-a', 0, t, t);
  insertVote.run(poll1, 'student-c', 1, t, t);
  insertVote.run(poll2, 'student-c', 0, t, t);
}

function seedWatchProgress(pdfId: string): void {
  const t = nowIso();
  const insertProgress = db.prepare(
    `INSERT INTO page_watch_progress (pdf_id, page_number, viewer_id, listened_ms, tab_hidden_ms, duration_ms, completed, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
  );
  insertProgress.run(pdfId, 1, 'student-a', 10000, 10000, 1, t);
  insertProgress.run(pdfId, 1, 'student-d', 5000, 10000, 0, t);
  insertProgress.run(pdfId, 2, 'student-a', 12000, 10000, 1, t);
}

test('GET /api/pdfs/:id/report/summary aggregates quiz, poll, questions and per-page watch progress for the owner', async () => {
  const pdfId = 'report-summary-01';
  seedReportPdf(pdfId, 'private');
  seedQuizAttempts(pdfId);
  seedPollVotes(pdfId);
  seedWatchProgress(pdfId);

  const app = await buildApp();
  try {
    const join = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/join`, headers: OWNER_HEADERS, payload: { client_id: 'teacher' } });
    assert.equal(join.statusCode, 200);
    const ask = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/questions`, payload: { client_id: 'student-e', user_code: 'Eve', question: 'Can you explain page 2 again?' } });
    assert.equal(ask.statusCode, 201);

    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/report/summary`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as {
      participant_count: number;
      quiz: { attempt_count: number; participant_count: number; average_score: number | null };
      polls: { poll_count: number; vote_count: number; participant_count: number; participation_rate: number };
      questions: { count: number; participant_count: number };
      watch_progress: { pages: Array<{ page_number: number; total_viewers: number; completed_viewers: number; completion_rate: number; avg_listened_ratio: number | null }> };
    };

    assert.equal(body.participant_count, 5);
    assert.deepEqual(body.quiz, { attempt_count: 2, participant_count: 2, average_score: 70 });
    assert.equal(body.polls.poll_count, 2);
    assert.equal(body.polls.vote_count, 3);
    assert.equal(body.polls.participant_count, 2);
    assert.equal(body.polls.participation_rate, 0.3);
    assert.deepEqual(body.questions, { count: 1, participant_count: 1 });
    assert.equal(body.watch_progress.pages.length, 3);
    assert.deepEqual(body.watch_progress.pages.map((page) => page.page_number), [1, 2, 3]);
    assert.equal(body.watch_progress.pages[0].total_viewers, 2);
    assert.equal(body.watch_progress.pages[0].completed_viewers, 1);
    assert.equal(body.watch_progress.pages[0].completion_rate, 0.5);
    assert.equal(body.watch_progress.pages[0].avg_listened_ratio, 0.75);
    assert.equal(body.watch_progress.pages[1].completion_rate, 1);
    assert.equal(body.watch_progress.pages[1].avg_listened_ratio, 1);
    assert.equal(body.watch_progress.pages[2].completion_rate, 0);
    assert.equal(body.watch_progress.pages[2].avg_listened_ratio, null);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/summary is only available to owners or editors', async () => {
  seedReportPdf('report-perm-priv', 'private');
  seedReportPdf('report-perm-pub1', 'public');
  seedReportPdf('report-perm-edit', 'public_editable');

  const app = await buildApp();
  try {
    const privateForbidden = await app.inject({ method: 'GET', url: '/api/pdfs/report-perm-priv/report/summary', headers: OTHER_HEADERS });
    assert.equal(privateForbidden.statusCode, 403);

    const publicForbidden = await app.inject({ method: 'GET', url: '/api/pdfs/report-perm-pub1/report/summary', headers: OTHER_HEADERS });
    assert.equal(publicForbidden.statusCode, 403);

    const editableAllowed = await app.inject({ method: 'GET', url: '/api/pdfs/report-perm-edit/report/summary', headers: OTHER_HEADERS });
    assert.equal(editableAllowed.statusCode, 200);

    const missing = await app.inject({ method: 'GET', url: '/api/pdfs/report-missing-1/report/summary', headers: OWNER_HEADERS });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});
