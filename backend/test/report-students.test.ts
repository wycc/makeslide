import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'student-owner'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('student-owner'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string; visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM quiz_attempts WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? 'student-owner', opts.visibility ?? 'private', t, t);
}

function seedQuizWithAttempts(pdfId: string): number {
  const t = nowIso();
  const uid = `${pdfId}-${Date.now()}`;
  const questionsJson = JSON.stringify([
    { id: 'q1', question: 'What is 1+1?', options: [{ text: '1' }, { text: '2' }, { text: '3' }], answer_indices: [1], type: 'single' },
    { id: 'q2', question: 'Select all primes', options: [{ text: '2' }, { text: '3' }, { text: '4' }], answer_indices: [0, 1], type: 'multiple' },
  ]);
  const quizId = Number(
    db.prepare(`INSERT INTO quiz_sets (pdf_id,title,prompt,questions_json,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(pdfId, 'Math Quiz', '', questionsJson, t, t).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO quiz_attempts (pdf_id,quiz_id,session_id,client_id,code,answers_json,score,submitted_at,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?,?,?,?)`,
  ).run(pdfId, quizId, `ses-a-${uid}`, `student-a-${uid}`, JSON.stringify({ q1: [1], q2: [0, 1] }), 100, t, t, t);
  db.prepare(
    `INSERT INTO quiz_attempts (pdf_id,quiz_id,session_id,client_id,code,answers_json,score,submitted_at,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?,?,?,?)`,
  ).run(pdfId, quizId, `ses-b-${uid}`, `student-b-${uid}`, JSON.stringify({ q1: [0], q2: [0] }), 40, t, t, t);
  return quizId;
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM quiz_attempts WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /api/pdfs/:id/report/students returns student records for owner', async () => {
  const id = `srtest-${Date.now()}`;
  seedPdf(id);
  seedQuizWithAttempts(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/report/students`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    const body = JSON.parse(res.body) as { students: Array<{ client_id: string; attempt_count: number; average_score: number | null; attempts: unknown[] }> };
    assert.equal(body.students.length, 2, 'should have 2 students');
    const studentA = body.students.find((s) => s.client_id.startsWith('student-a-'));
    assert.ok(studentA, 'student-a should be present');
    assert.equal(studentA?.attempt_count, 1);
    assert.equal(studentA?.average_score, 100);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/students returns question results with is_correct flag', async () => {
  const id = `srtest-qr-${Date.now()}`;
  seedPdf(id);
  seedQuizWithAttempts(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/report/students`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { students: Array<{ client_id: string; attempts: Array<{ question_results: Array<{ question_id: string; is_correct: boolean }> }> }> };
    const studentA = body.students.find((s) => s.client_id.startsWith('student-a-'))!;
    assert.ok(studentA, 'student-a should be present');
    const qrA = studentA.attempts[0]!.question_results;
    assert.ok(qrA.find((q) => q.question_id === 'q1')?.is_correct, 'student-a q1 should be correct');
    assert.ok(qrA.find((q) => q.question_id === 'q2')?.is_correct, 'student-a q2 should be correct');

    const studentB = body.students.find((s) => s.client_id.startsWith('student-b-'))!;
    assert.ok(studentB, 'student-b should be present');
    const qrB = studentB.attempts[0]!.question_results;
    assert.equal(qrB.find((q) => q.question_id === 'q1')?.is_correct, false, 'student-b q1 should be wrong');
    assert.equal(qrB.find((q) => q.question_id === 'q2')?.is_correct, false, 'student-b q2 should be wrong');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/students returns empty array when no attempts', async () => {
  const id = `srtest-empty-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/report/students`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { students: unknown[] };
    assert.equal(body.students.length, 0);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/students returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/pdfs/no-such-pdf-sr/report/students', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/students returns 403 for private PDF without auth', async () => {
  const id = `srtest-priv-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/report/students` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});
