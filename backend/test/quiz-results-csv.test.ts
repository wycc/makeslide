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

function seedQuizAttempts(pdfId: string): void {
  const t = nowIso();
  const quizId = Number(
    db.prepare(`INSERT INTO quiz_sets (pdf_id,title,prompt,questions_json,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(pdfId, 'Q1', '', '[]', t, t).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO quiz_attempts (pdf_id,quiz_id,session_id,client_id,code,answers_json,score,submitted_at,created_at,updated_at)
     VALUES (?,?,?,?,NULL,?,?,?,?,?)`,
  ).run(pdfId, quizId, 'ses-a', 'student-a', '{"q1":[0]}', 80, t, t, t);
  db.prepare(
    `INSERT INTO quiz_attempts (pdf_id,quiz_id,session_id,client_id,code,answers_json,score,submitted_at,created_at,updated_at)
     VALUES (?,?,?,?,NULL,?,?,?,?,?)`,
  ).run(pdfId, quizId, 'ses-b', 'student-b', '{"q1":[1]}', 60, t, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM quiz_attempts WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /api/pdfs/:id/quiz-results.csv returns CSV with correct headers for owner', async () => {
  const id = `csvtest-${Date.now()}`;
  seedPdf(id);
  seedQuizAttempts(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/quiz-results.csv`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    assert.ok(res.headers['content-type']?.toString().includes('text/csv'), `unexpected content-type: ${String(res.headers['content-type'])}`);
    const lines = res.body.trim().split('\n');
    assert.equal(lines[0], 'attempt_id,quiz_id,quiz_title,client_id,code,score,submitted_at,answers_json');
    assert.equal(lines.length, 3, 'header + 2 data rows');
    assert.ok(lines[1].includes('student-a'));
    assert.ok(lines[2].includes('student-b'));
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/quiz-results.csv returns empty CSV (header only) when no attempts', async () => {
  const id = `csvtest-empty-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/quiz-results.csv`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200);
    const lines = res.body.trim().split('\n');
    assert.equal(lines.length, 1, 'only header row when no attempts');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/quiz-results.csv returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/pdfs/nonexistent-csv-id/quiz-results.csv', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/quiz-results.csv returns 403 for private PDF without auth', async () => {
  const id = `csvtest-priv-${Date.now()}`;
  seedPdf(id, { ownerSub: 'owner-2', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/quiz-results.csv` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});
