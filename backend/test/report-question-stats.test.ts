import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = {
  cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`,
  'content-type': 'application/json',
};

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(pdfId: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 'Test PDF', `${pdfId}.pdf`, t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,?,NULL,NULL,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, `${pdfId}-1`, `pages/${pdfId}-1.jpg`, t, t);
}

const SAMPLE_QUESTIONS = JSON.stringify([
  {
    id: 'q1',
    question: '下列何者正確？',
    options: [{ text: '選項A' }, { text: '選項B' }, { text: '選項C' }, { text: '選項D' }],
    answer_indices: [0],
    type: 'single',
  },
  {
    id: 'q2',
    question: '多選題：以下哪些正確？',
    options: [{ text: '甲' }, { text: '乙' }, { text: '丙' }],
    answer_indices: [0, 2],
    type: 'multiple',
  },
]);

function seedQuizSet(pdfId: string, title: string, questionsJson: string = SAMPLE_QUESTIONS): number {
  const t = nowIso();
  return Number(
    db
      .prepare(
        `INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?)`,
      )
      .run(pdfId, title, questionsJson, t, t).lastInsertRowid,
  );
}

function seedAttempt(pdfId: string, quizId: number, clientId: string, answersJson: string, score: number = 50): void {
  const t = nowIso();
  db.prepare(
    `INSERT INTO quiz_attempts (pdf_id, quiz_id, session_id, client_id, code, answers_json, score, submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(pdfId, quizId, `${pdfId}-session-${clientId}`, `${pdfId}-${clientId}`, answersJson, score, t, t, t);
}

interface QuestionStat {
  question_id: string;
  question: string;
  option_count: number;
  attempt_count: number;
  correct_count: number;
  wrong_count: number;
  correct_rate: number;
  option_votes: number[];
}

interface ReportBody {
  quiz: {
    attempt_count: number;
    participant_count: number;
    average_score: number | null;
    question_stats: QuestionStat[];
  };
}

// Test 1: no quiz attempts → question_stats shows questions with attempt_count=0
test('question_stats is empty array when quiz has no attempts', async () => {
  const pdfId = 'qs-test-no-attempts';
  seedPdf(pdfId);
  seedQuizSet(pdfId, 'Empty Quiz');

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/report/summary`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as ReportBody;
    assert.ok(Array.isArray(body.quiz.question_stats));
    // Quiz set has 2 questions; no attempts so each shows attempt_count=0, correct_rate=0
    assert.equal(body.quiz.question_stats.length, 2);
    for (const stat of body.quiz.question_stats) {
      assert.equal(stat.attempt_count, 0);
      assert.equal(stat.correct_count, 0);
      assert.equal(stat.correct_rate, 0);
    }
  } finally {
    await app.close();
  }
});

// Test 2: question_stats is empty array when there are no quiz sets at all
test('question_stats is empty array when there are no quiz sets', async () => {
  const pdfId = 'qs-test-no-quizsets';
  seedPdf(pdfId);

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/report/summary`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as ReportBody;
    assert.ok(Array.isArray(body.quiz.question_stats));
    assert.equal(body.quiz.question_stats.length, 0);
  } finally {
    await app.close();
  }
});

// Test 3: correct_rate computed correctly (2 correct out of 3 attempts for q1)
test('accuracy_rate is correct_count / total_attempts for each question', async () => {
  const pdfId = 'qs-test-accuracy';
  seedPdf(pdfId);
  const quizId = seedQuizSet(pdfId, '正確率測試');

  // student-a: q1 correct [0], q2 wrong [1]
  seedAttempt(pdfId, quizId, 'student-a', JSON.stringify({ q1: [0], q2: [1] }), 50);
  // student-b: q1 correct [0], q2 wrong [0, 1]
  seedAttempt(pdfId, quizId, 'student-b', JSON.stringify({ q1: [0], q2: [0, 1] }), 50);
  // student-c: q1 wrong [1], q2 correct [0, 2]
  seedAttempt(pdfId, quizId, 'student-c', JSON.stringify({ q1: [1], q2: [0, 2] }), 50);

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/report/summary`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as ReportBody;

    const stats = body.quiz.question_stats;
    assert.equal(stats.length, 2);

    const q1Stat = stats.find((s) => s.question_id === 'q1');
    assert.ok(q1Stat, 'q1 stat should exist');
    assert.equal(q1Stat.attempt_count, 3);
    assert.equal(q1Stat.correct_count, 2);
    assert.ok(Math.abs(q1Stat.correct_rate - 2 / 3) < 1e-9, `correct_rate should be ~0.667, got ${q1Stat.correct_rate}`);

    const q2Stat = stats.find((s) => s.question_id === 'q2');
    assert.ok(q2Stat, 'q2 stat should exist');
    assert.equal(q2Stat.attempt_count, 3);
    assert.equal(q2Stat.correct_count, 1);
    assert.ok(Math.abs(q2Stat.correct_rate - 1 / 3) < 1e-9, `correct_rate should be ~0.333, got ${q2Stat.correct_rate}`);
  } finally {
    await app.close();
  }
});

// Test 4: option_votes correctly tallies which options were chosen
test('option_counts correctly tallies chosen options', async () => {
  const pdfId = 'qs-test-option-counts';
  seedPdf(pdfId);
  const quizId = seedQuizSet(pdfId, '選項統計測試');

  // For q1 (4 options, correct=[0]):
  // oc-a picks [0], oc-b picks [0], oc-c picks [1]
  seedAttempt(pdfId, quizId, 'oc-a', JSON.stringify({ q1: [0], q2: [] }), 50);
  seedAttempt(pdfId, quizId, 'oc-b', JSON.stringify({ q1: [0], q2: [] }), 50);
  seedAttempt(pdfId, quizId, 'oc-c', JSON.stringify({ q1: [1], q2: [] }), 50);

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/report/summary`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as ReportBody;

    const q1Stat = body.quiz.question_stats.find((s) => s.question_id === 'q1');
    assert.ok(q1Stat, 'q1 stat should exist');
    assert.deepEqual(q1Stat.option_votes, [2, 1, 0, 0]);
    assert.equal(q1Stat.option_count, 4);
  } finally {
    await app.close();
  }
});

// Test 5: multiple quiz sets — all question_stats appear
test('question_stats includes questions from all quiz sets', async () => {
  const pdfId = 'qs-test-multi-sets';
  seedPdf(pdfId);

  const quiz1Questions = JSON.stringify([
    { id: 'a1', question: 'Quiz1 Q1', options: [{ text: 'X' }, { text: 'Y' }], answer_indices: [0], type: 'single' },
  ]);
  const quiz2Questions = JSON.stringify([
    { id: 'b1', question: 'Quiz2 Q1', options: [{ text: 'P' }, { text: 'Q' }], answer_indices: [1], type: 'single' },
  ]);

  const quizId1 = seedQuizSet(pdfId, 'Set A', quiz1Questions);
  const quizId2 = seedQuizSet(pdfId, 'Set B', quiz2Questions);

  seedAttempt(pdfId, quizId1, 'ms-a', JSON.stringify({ a1: [0] }), 100);
  seedAttempt(pdfId, quizId2, 'ms-b', JSON.stringify({ b1: [0] }), 0);

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/report/summary`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as ReportBody;

    const stats = body.quiz.question_stats;
    assert.equal(stats.length, 2);

    const a1Stat = stats.find((s) => s.question_id === 'a1');
    assert.ok(a1Stat, 'a1 from Set A should exist');
    assert.equal(a1Stat.correct_count, 1);
    assert.equal(a1Stat.correct_rate, 1);

    const b1Stat = stats.find((s) => s.question_id === 'b1');
    assert.ok(b1Stat, 'b1 from Set B should exist');
    assert.equal(b1Stat.correct_count, 0);
    assert.equal(b1Stat.correct_rate, 0);
  } finally {
    await app.close();
  }
});
