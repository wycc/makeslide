import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'owner-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-1'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string | null; visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM quiz_attempts WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? 'owner-1', opts.visibility ?? 'private', t, t);
}

function seedQuizWithAttempts(pdfId: string): void {
  const t = nowIso();
  const questions = JSON.stringify([
    {
      id: 'q1',
      question: '什麼是 TypeScript？',
      options: [{ text: '超集合' }, { text: '函式語言' }],
      answer_indices: [0],
      type: 'single',
    },
  ]);
  const quizId = Number(
    db.prepare(`INSERT INTO quiz_sets (pdf_id,title,prompt,questions_json,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(pdfId, '基礎測驗', '', questions, t, t).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO quiz_attempts (pdf_id,quiz_id,session_id,client_id,code,answers_json,score,submitted_at,created_at,updated_at)
     VALUES (?,?,?,?,NULL,?,?,?,?,?)`,
  ).run(pdfId, quizId, 'ses-a', 'alice', JSON.stringify({ q1: [0] }), 100, t, t, t);
  db.prepare(
    `INSERT INTO quiz_attempts (pdf_id,quiz_id,session_id,client_id,code,answers_json,score,submitted_at,created_at,updated_at)
     VALUES (?,?,?,?,NULL,?,?,?,?,?)`,
  ).run(pdfId, quizId, 'ses-b', 'bob', JSON.stringify({ q1: [1] }), 0, t, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM quiz_attempts WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /api/pdfs/:id/report/students returns student list for owner', async () => {
  const id = `students-${Date.now()}`;
  seedPdf(id);
  seedQuizWithAttempts(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/report/students`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    const body = res.json() as { students: Array<{ client_id: string; attempt_count: number; average_score: number | null; attempts: unknown[] }> };
    assert.ok(Array.isArray(body.students), 'should have students array');
    assert.equal(body.students.length, 2, 'should have 2 students');
    const alice = body.students.find((s) => s.client_id === 'alice');
    assert.ok(alice, 'alice should be in results');
    assert.equal(alice.attempt_count, 1);
    assert.equal(alice.average_score, 100);
    assert.equal(alice.attempts.length, 1);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/students includes per-question correctness', async () => {
  const id = `students-q-${Date.now()}`;
  seedPdf(id);
  seedQuizWithAttempts(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/report/students`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { students: Array<{ client_id: string; attempts: Array<{ quiz_title: string; score: number | null; question_results: Array<{ question_id: string; is_correct: boolean }> }> }> };
    const alice = body.students.find((s) => s.client_id === 'alice')!;
    const attempt = alice.attempts[0]!;
    assert.equal(attempt.quiz_title, '基礎測驗');
    assert.equal(attempt.question_results.length, 1);
    assert.equal(attempt.question_results[0]!.is_correct, true, 'alice answered correctly');

    const bob = body.students.find((s) => s.client_id === 'bob')!;
    const bobAttempt = bob.attempts[0]!;
    assert.equal(bobAttempt.question_results[0]!.is_correct, false, 'bob answered incorrectly');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/students returns empty list when no attempts', async () => {
  const id = `students-empty-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/report/students`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { students: unknown[] };
    assert.deepEqual(body.students, []);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/students returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/pdfs/nonexistent-students-id/report/students', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/students returns 403 for private PDF without auth', async () => {
  const id = `students-priv-${Date.now()}`;
  seedPdf(id, { ownerSub: 'owner-2', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/report/students` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});
