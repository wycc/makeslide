import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { upsertAccountProfile } from '../src/services/accountProfiles';
import { buildQuizScoreSheet, type ScoreSheetQuestion } from '../src/services/quizScoreSheet';

/**
 * The teacher's "download scores" sheet: one row per attempt, each question's score, a total.
 *
 * What matters most is that the numbers agree with the rest of the product — per-question scores
 * add up to the total, the total equals the score the history panel shows for a choice-only quiz,
 * and essays use the same "teacher override, else AI" rule as the grading panel.
 */

setSystemAuthSettings({ googleAuthEnabled: false });

const BOM = '﻿';

function sessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `makeslide_session=${encodeURIComponent(`${payload}.${sig}`)}`;
}

const OWNER = 'score-sheet-owner';
const STUDENT = 'score-sheet-student';

const CHOICE_QUESTIONS: ScoreSheetQuestion[] = [
  { id: 'q1', type: 'single', options: ['a', 'b'], answer_indices: [0] },
  { id: 'q2', type: 'single', options: ['a', 'b'], answer_indices: [1] },
  // Four options, answer {0,1}: picking only 0 gets 3 of 4 options right → 3/4 of the points.
  { id: 'q3', type: 'multiple', options: ['a', 'b', 'c', 'd'], answer_indices: [0, 1] },
];

function attempt(answers: Record<string, number[]>, extra: Partial<{ code: string | null; display_name: string | null; session_id: string; client_id: string }> = {}) {
  return {
    session_id: extra.session_id ?? 's1',
    client_id: extra.client_id ?? 'c1',
    code: extra.code ?? null,
    display_name: extra.display_name ?? null,
    submitted_at: '2026-09-15T04:12:06.000Z',
    answers,
  };
}

test('per-question scores follow the quiz scoring rules and add up to the total', () => {
  const sheet = buildQuizScoreSheet({
    questions: CHOICE_QUESTIONS,
    attempts: [attempt({ q1: [0], q2: [0], q3: [0] })],
    essays: [],
  });
  assert.deepEqual(sheet.max_scores, [33.33, 33.33, 33.33]);
  const [row] = sheet.rows;
  assert.deepEqual(row!.scores, [33.33, 0, 25]);
  assert.equal(row!.total, 58.33);
  assert.equal(row!.has_ungraded, false);
});

test('a fully correct attempt totals exactly 100, not 99.99 from summing rounded cells', () => {
  // Summing the rounded 33.33s would give 99.99; the total is computed from the unrounded values,
  // the way computeAttemptScore() does it, so it matches the history panel's "100 分".
  const sheet = buildQuizScoreSheet({
    questions: CHOICE_QUESTIONS,
    attempts: [attempt({ q1: [0], q2: [1], q3: [0, 1] })],
    essays: [],
  });
  assert.equal(sheet.rows[0]!.total, 100);
});

test('unanswered questions score 0 rather than being left blank', () => {
  const sheet = buildQuizScoreSheet({ questions: CHOICE_QUESTIONS.slice(0, 2), attempts: [attempt({})], essays: [] });
  assert.deepEqual(sheet.rows[0]!.scores, [0, 0]);
  assert.equal(sheet.rows[0]!.total, 0);
});

test('essays use the teacher score over the AI score, and ungraded ones stay blank', () => {
  const questions: ScoreSheetQuestion[] = [
    { id: 'q1', type: 'single', options: ['a', 'b'], answer_indices: [0], score: 40 },
    { id: 'e1', type: 'essay', options: [], answer_indices: [], score: 30 },
    { id: 'e2', type: 'essay', options: [], answer_indices: [], score: 30 },
  ];
  const sheet = buildQuizScoreSheet({
    questions,
    attempts: [
      attempt({ q1: [0] }, { client_id: 'graded' }),
      attempt({ q1: [0] }, { client_id: 'pending' }),
    ],
    essays: [
      { session_id: 's1', client_id: 'graded', question_id: 'e1', ai_score: 20, teacher_score: 25 },
      { session_id: 's1', client_id: 'graded', question_id: 'e2', ai_score: 10, teacher_score: null },
      { session_id: 's1', client_id: 'pending', question_id: 'e1', ai_score: 18, teacher_score: null },
    ],
  });
  const [graded, pending] = sheet.rows;
  assert.deepEqual(graded!.scores, [40, 25, 10]);
  assert.equal(graded!.total, 75);
  assert.equal(graded!.has_ungraded, false);
  // e2 has no essay row at all for this student — nothing to count yet, so blank and flagged.
  assert.deepEqual(pending!.scores, [40, 18, null]);
  assert.equal(pending!.total, 58);
  assert.equal(pending!.has_ungraded, true);
});

test('essay scores are matched to the attempt by session and client, not only by student', () => {
  const questions: ScoreSheetQuestion[] = [{ id: 'e1', type: 'essay', options: [], answer_indices: [] }];
  const sheet = buildQuizScoreSheet({
    questions,
    attempts: [attempt({}, { session_id: 'first' }), attempt({}, { session_id: 'second' })],
    essays: [
      { session_id: 'first', client_id: 'c1', question_id: 'e1', ai_score: 30, teacher_score: null },
      { session_id: 'second', client_id: 'c1', question_id: 'e1', ai_score: 90, teacher_score: null },
    ],
  });
  assert.deepEqual(sheet.rows.map((r) => r.total), [30, 90]);
});

// ── Route ────────────────────────────────────────────────────────────────────

function seed(pdfId: string): number {
  const t = new Date().toISOString();
  cleanup(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,'public',?,?)`,
  ).run(pdfId, `PDF ${pdfId}`, `${pdfId}.pdf`, OWNER, t, t);
  const questions = [
    { id: 'q1', type: 'single', question: '一', options: [{ text: 'a' }, { text: 'b' }], answer_indices: [0], score: 50 },
    { id: 'e1', type: 'essay', question: '二', options: [], answer_indices: [], score: 50 },
  ];
  const quizId = Number(
    db.prepare(`INSERT INTO quiz_sets (pdf_id,title,prompt,questions_json,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(pdfId, '小考一', '', JSON.stringify(questions), t, t).lastInsertRowid,
  );
  // (session_id, client_id) is unique across the whole table, so the session carries the deck id.
  const session = `${pdfId}-s1`;
  const insertAttempt = db.prepare(
    `INSERT INTO quiz_attempts (pdf_id,quiz_id,session_id,client_id,code,sub,answers_json,score,submitted_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  insertAttempt.run(pdfId, quizId, session, 'c-named', 'd000018238', STUDENT, '{"q1":[0]}', 50, '2026-09-15T04:12:06.000Z', t, t);
  // A code that starts with "=" — student-typed text must not become a spreadsheet formula.
  insertAttempt.run(pdfId, quizId, session, 'c-anon', '=HYPERLINK("x")', null, '{"q1":[1]}', 0, '2026-09-15T04:13:00.000Z', t, t);
  db.prepare(
    `INSERT INTO quiz_essay_answers (pdf_id,quiz_id,question_id,session_id,client_id,code,sub,file_names,max_score,ai_score,ai_feedback,teacher_score,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'[]',50,?,NULL,?,?,?)`,
  ).run(pdfId, quizId, 'e1', session, 'c-named', 'd000018238', STUDENT, 30, 40, t, t);
  upsertAccountProfile({ sub: STUDENT, email: `${STUDENT}@example.com`, name: 'Yu-Chung Wang' });
  return quizId;
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM quiz_essay_answers WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM quiz_attempts WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
}

test('GET …/quizzes/:quizId/scores.csv gives the teacher one row per attempt with name, code and total', async () => {
  const pdfId = `scoresheet-${Date.now()}`;
  const quizId = seed(pdfId);
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/quizzes/${quizId}/scores.csv?tz=Asia/Taipei`,
      headers: { cookie: sessionCookie(OWNER) },
    });
    assert.equal(res.statusCode, 200, res.body.slice(0, 200));
    assert.match(String(res.headers['content-type']), /text\/csv/);
    assert.match(String(res.headers['content-disposition']), /scores\.csv/);
    assert.ok(res.body.startsWith(BOM), 'Excel needs the BOM to read the Chinese headers');

    const lines = res.body.slice(BOM.length).trim().split('\n');
    assert.equal(lines[0], '姓名,代碼,作答時間,第1題（50分）,第2題（50分）,總分,備註');
    // Choice 50 + essay teacher score 40 (over the AI's 30); time shown in Taipei, not UTC.
    assert.equal(lines[1], 'Yu-Chung Wang,d000018238,2026-09-15 12:12:06,50,40,90,');
    // No account → empty name; the "=" code is defanged; the essay was never uploaded → blank + note.
    assert.equal(lines[2], `,"'=HYPERLINK(""x"")",2026-09-15 12:13:00,0,,0,尚有問答題未評分`);
    assert.equal(lines.length, 3);
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('scores.csv switches its headers to English with lang=en', async () => {
  const pdfId = `scoresheet-en-${Date.now()}`;
  const quizId = seed(pdfId);
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/quizzes/${quizId}/scores.csv?lang=en`,
      headers: { cookie: sessionCookie(OWNER) },
    });
    assert.equal(res.statusCode, 200);
    const [header, first] = res.body.slice(BOM.length).trim().split('\n');
    assert.equal(header, 'Name,Code,Submitted at,Q1 (50 pts),Q2 (50 pts),Total,Note');
    // No tz → UTC.
    assert.match(first!, /2026-09-15 04:12:06/);
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('scores.csv is refused to a student who can read the deck but not edit it', async () => {
  // The deck is public, so a student can take the quiz — but the sheet names every classmate.
  const pdfId = `scoresheet-403-${Date.now()}`;
  const quizId = seed(pdfId);
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/quizzes/${quizId}/scores.csv`,
      headers: { cookie: sessionCookie(STUDENT) },
    });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('scores.csv returns 404 for a quiz that belongs to another deck', async () => {
  const pdfId = `scoresheet-404-${Date.now()}`;
  const otherId = `scoresheet-other-${Date.now()}`;
  seed(pdfId);
  const otherQuizId = seed(otherId);
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/quizzes/${otherQuizId}/scores.csv`,
      headers: { cookie: sessionCookie(OWNER) },
    });
    assert.equal(res.statusCode, 404);
  } finally {
    cleanup(pdfId);
    cleanup(otherId);
    await app.close();
  }
});
