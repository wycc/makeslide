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
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}` };

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable' = 'private'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', 1, 'account-1', ?, ?, ?)`,
  ).run(pdfId, `Quiz PDF ${pdfId}`, `${pdfId}.pdf`, visibility, t, t);
}

function seedQuiz(pdfId: string): void {
  const t = nowIso();
  const questions = [
    { id: 'q1', question: 'Q1?', options: ['A', 'B', 'C'], answer_indices: [0] },
    { id: 'q2', question: 'Q2?', options: ['X', 'Y'], answer_indices: [1] },
  ];
  const quizId = Number(
    db.prepare(`INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, created_at, updated_at) VALUES (?, 'Quiz', '', ?, ?, ?)`)
      .run(pdfId, JSON.stringify(questions), t, t).lastInsertRowid,
  );
  const insertAttempt = db.prepare(
    `INSERT INTO quiz_attempts (pdf_id, quiz_id, session_id, client_id, code, answers_json, score, submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  insertAttempt.run(pdfId, quizId, 's1', 'student-a', JSON.stringify({ q1: [0], q2: [0] }), 50, t, t, t);
  insertAttempt.run(pdfId, quizId, 's2', 'student-b', JSON.stringify({ q1: [1], q2: [1] }), 50, t, t, t);
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM quiz_attempts WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
}

test('GET /api/pdfs/:id/report/questions.csv returns per-question stats', async () => {
  const pdfId = 'report-q-csv-01';
  seedPdf(pdfId, 'private');
  seedQuiz(pdfId);
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/report/questions.csv`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    assert.match(resp.headers['content-type'] as string, /text\/csv/);
    assert.match(resp.headers['content-disposition'] as string, /attachment; filename="report-questions-report-q-csv-01\.csv"/);
    const lines = resp.body.trim().split('\n');
    assert.equal(lines[0], 'question_id,question,option_count,attempt_count,correct_count,wrong_count,correct_rate,option_votes');
    // q1: answer [0]; a picked 0 (correct), b picked 1 (wrong) -> 1/1, votes 1|1|0
    assert.equal(lines[1], 'q1,Q1?,3,2,1,1,0.5,1|1|0');
    // q2: answer [1]; a picked 0 (wrong), b picked 1 (correct) -> 1/1, votes 1|1
    assert.equal(lines[2], 'q2,Q2?,2,2,1,1,0.5,1|1');
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/questions.csv returns only the header when there is no quiz', async () => {
  const pdfId = 'report-q-csv-02';
  seedPdf(pdfId, 'private');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/report/questions.csv`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    assert.equal(resp.body, '﻿question_id,question,option_count,attempt_count,correct_count,wrong_count,correct_rate,option_votes');
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/questions.csv returns 403 for a non-owner on a private PDF', async () => {
  const pdfId = 'report-q-csv-03';
  seedPdf(pdfId, 'private');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/report/questions.csv`, headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 403);
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/questions.csv returns 404 for an unknown PDF', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/nope-q-xx/report/questions.csv`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 404);
  } finally {
    await app.close();
  }
});
