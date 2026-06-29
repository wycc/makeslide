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
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-2'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string | null; visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM page_poll_votes WHERE poll_id IN (SELECT id FROM page_polls WHERE pdf_id = ?)`).run(id);
  db.prepare(`DELETE FROM page_polls WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? 'owner-1', opts.visibility ?? 'private', t, t);
  db.prepare(`INSERT INTO pages (pdf_id,page_number,status,created_at,updated_at) VALUES (?,1,'ready',?,?)`).run(id, t, t);
}

function seedPoll(pdfId: string): number {
  const t = nowIso();
  const pollId = Number(
    db.prepare(
      `INSERT INTO page_polls (pdf_id,page_number,question,options_json,is_active,show_results,created_at,updated_at)
       VALUES (?,1,?,?,1,1,?,?)`,
    ).run(pdfId, '哪個答案正確？', JSON.stringify(['選項 A', '選項 B']), t, t).lastInsertRowid,
  );
  db.prepare(`INSERT INTO page_poll_votes (poll_id,voter_id,option_index,created_at,updated_at) VALUES (?,?,0,?,?)`).run(pollId, 'alice', t, t);
  db.prepare(`INSERT INTO page_poll_votes (poll_id,voter_id,option_index,created_at,updated_at) VALUES (?,?,1,?,?)`).run(pollId, 'bob', t, t);
  db.prepare(`INSERT INTO page_poll_votes (poll_id,voter_id,option_index,created_at,updated_at) VALUES (?,?,0,?,?)`).run(pollId, 'voter-anon-1', t, t);
  return pollId;
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM page_poll_votes WHERE poll_id IN (SELECT id FROM page_polls WHERE pdf_id = ?)`).run(id);
  db.prepare(`DELETE FROM page_polls WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('GET /polls/:pollId/voters returns each voter with their option for the owner', async () => {
  const id = `pollvoters-${Date.now()}`;
  seedPdf(id);
  const pollId = seedPoll(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/polls/${pollId}/voters`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    const body = res.json() as { voters: Array<{ voter_id: string; option_index: number; option_text: string }> };
    assert.equal(body.voters.length, 3);
    const alice = body.voters.find((v) => v.voter_id === 'alice');
    assert.ok(alice, 'alice present');
    assert.equal(alice.option_index, 0);
    assert.equal(alice.option_text, '選項 A');
    const bob = body.voters.find((v) => v.voter_id === 'bob');
    assert.equal(bob?.option_text, '選項 B');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /polls/:pollId/voters is forbidden for a non-editor (protects voter identity)', async () => {
  const id = `pollvoters-priv-${Date.now()}`;
  seedPdf(id, { ownerSub: 'owner-1', visibility: 'private' });
  const pollId = seedPoll(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/polls/${pollId}/voters`, headers: OTHER_HEADERS });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /polls/:pollId/voters returns 404 for an unknown poll', async () => {
  const id = `pollvoters-404-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/polls/99999999/voters`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    cleanup(id);
    await app.close();
  }
});
