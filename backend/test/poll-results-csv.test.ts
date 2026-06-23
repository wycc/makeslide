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
  db.prepare(`DELETE FROM page_poll_votes WHERE poll_id IN (SELECT id FROM page_polls WHERE pdf_id = ?)`).run(id);
  db.prepare(`DELETE FROM page_polls WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',2,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? 'owner-1', opts.visibility ?? 'private', t, t);
  db.prepare(`INSERT INTO pages (pdf_id,page_number,status,created_at,updated_at) VALUES (?,1,'ready',?,?)`).run(id, t, t);
  db.prepare(`INSERT INTO pages (pdf_id,page_number,status,created_at,updated_at) VALUES (?,2,'ready',?,?)`).run(id, t, t);
}

function seedPolls(pdfId: string): void {
  const t = nowIso();
  const pollId1 = Number(
    db.prepare(
      `INSERT INTO page_polls (pdf_id,page_number,question,options_json,is_active,show_results,created_at,updated_at)
       VALUES (?,1,?,?,1,1,?,?)`,
    ).run(pdfId, '哪個答案正確？', JSON.stringify(['選項 A', '選項 B', '選項 C']), t, t).lastInsertRowid,
  );
  db.prepare(`INSERT INTO page_poll_votes (poll_id,voter_id,option_index,created_at,updated_at) VALUES (?,?,0,?,?)`).run(pollId1, 'voter-1', t, t);
  db.prepare(`INSERT INTO page_poll_votes (poll_id,voter_id,option_index,created_at,updated_at) VALUES (?,?,0,?,?)`).run(pollId1, 'voter-2', t, t);
  db.prepare(`INSERT INTO page_poll_votes (poll_id,voter_id,option_index,created_at,updated_at) VALUES (?,?,1,?,?)`).run(pollId1, 'voter-3', t, t);

  db.prepare(
    `INSERT INTO page_polls (pdf_id,page_number,question,options_json,is_active,show_results,created_at,updated_at)
     VALUES (?,2,?,?,1,1,?,?)`,
  ).run(pdfId, '你喜歡哪個？', JSON.stringify(['選項 X', '選項 Y']), t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM page_poll_votes WHERE poll_id IN (SELECT id FROM page_polls WHERE pdf_id = ?)`).run(id);
  db.prepare(`DELETE FROM page_polls WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /api/pdfs/:id/poll-results.csv returns CSV with correct headers and data', async () => {
  const id = `pollcsv-${Date.now()}`;
  seedPdf(id);
  seedPolls(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/poll-results.csv`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    assert.ok(res.headers['content-type']?.toString().includes('text/csv'), `unexpected content-type: ${String(res.headers['content-type'])}`);
    const lines = res.body.trim().split('\n');
    assert.equal(lines[0], 'page_number,poll_id,poll_question,option_index,option_text,vote_count,total_votes');
    assert.ok(lines.length >= 5, `expected at least 5 lines (header + 3 options + 2 options), got ${lines.length}`);
    const dataLines = lines.slice(1);
    const page1Lines = dataLines.filter((l) => l.startsWith('1,'));
    assert.equal(page1Lines.length, 3, '3 options for page 1 poll');
    assert.ok(page1Lines[0].includes('選項 A'), 'first option text present');
    assert.ok(page1Lines[0].endsWith(',2,3'), 'option A has 2 votes, total 3');
    assert.ok(page1Lines[1].endsWith(',1,3'), 'option B has 1 vote, total 3');
    assert.ok(page1Lines[2].endsWith(',0,3'), 'option C has 0 votes, total 3');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/poll-results.csv returns only header when no polls', async () => {
  const id = `pollcsv-empty-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/poll-results.csv`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200);
    const lines = res.body.trim().split('\n');
    assert.equal(lines.length, 1, 'only header row when no polls');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/poll-results.csv returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/pdfs/nonexistent-poll-csv/poll-results.csv', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/poll-results.csv returns 403 for private PDF without auth', async () => {
  const id = `pollcsv-priv-${Date.now()}`;
  seedPdf(id, { ownerSub: 'owner-2', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/poll-results.csv` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});
