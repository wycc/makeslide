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

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}` };

function nowIso(): string {
  return new Date().toISOString();
}

function seedReportPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable' = 'private'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',3,'account-1',?,?,?)`,
  ).run(pdfId, 'Report PDF', `${pdfId}.pdf`, visibility, t, t);
  const insertPage = db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,status,created_at,updated_at)
     VALUES (?,?,?,?,'audio_ready',?,?)`,
  );
  for (const page of [1, 2, 3]) {
    insertPage.run(pdfId, page, `${pdfId}-${page}`, `pages/${pdfId}-${page}.jpg`, t, t);
  }
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

function seedComments(pdfId: string): void {
  const t = nowIso();
  const insertComment = db.prepare(
    `INSERT INTO page_comments (pdf_id, page_number, author, text, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  // Two questions on page 1 (2 viewers) -> question rate 1.0; none elsewhere.
  insertComment.run(pdfId, 1, 'student-a', '這頁看不懂', t);
  insertComment.run(pdfId, 1, 'student-d', '可以再解釋嗎', t);
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
}

test('GET /api/pdfs/:id/report/pages.csv returns per-page analytics ordered by page', async () => {
  const pdfId = 'report-pages-01';
  seedReportPdf(pdfId, 'private');
  seedPollVotes(pdfId);
  seedWatchProgress(pdfId);
  seedComments(pdfId);
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/report/pages.csv`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    assert.match(resp.headers['content-type'] as string, /text\/csv/);
    assert.match(resp.headers['content-disposition'] as string, /attachment; filename="Report PDF-pages\.csv"/);
    const lines = resp.body.trim().split('\n');
    assert.equal(lines[0], 'page_number,total_viewers,completed_viewers,completion_rate,poll_total_votes,poll_divergence_score,avg_listened_ratio,question_count,difficulty_score');
    // page 1: 2 viewers, 1 completed -> 0.5; poll votes split 1/1 -> divergence 0.5;
    //         listened ratios 1.0 and 0.5 -> avg 0.75; 2 questions / 2 viewers -> rate 1.0;
    //         difficulty = mean(incompletion 0.5, divergence 0.5, questionRate 1.0) = 0.6667
    assert.equal(lines[1], '1,2,1,0.5,2,0.5,0.75,2,0.6667');
    // page 2: 1 viewer completed -> 1; single vote -> divergence 0; listened 12000/10000 capped at 1;
    //         no questions -> difficulty mean(0,0,0) = 0
    assert.equal(lines[2], '2,1,1,1,1,0,1,0,0');
    // page 3: no viewers, no votes -> avg_listened_ratio + difficulty blank (no data, not 0)
    assert.equal(lines[3], '3,0,0,0,0,0,,0,');
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/pages.csv returns 403 for a non-owner on a private PDF', async () => {
  const pdfId = 'report-pages-02';
  seedReportPdf(pdfId, 'private');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/report/pages.csv`, headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 403);
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET /api/pdfs/:id/report/pages.csv returns 404 for an unknown PDF', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/nope-xyz/report/pages.csv`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 404);
  } finally {
    await app.close();
  }
});
