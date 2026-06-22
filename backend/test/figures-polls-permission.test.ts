import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import crypto from 'node:crypto';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}`, 'content-type': 'application/json' };
const OWNER_HEADERS_NO_BODY = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}` };
const OTHER_HEADERS_NO_BODY = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}` };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedPermPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM page_polls WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, visibility, t, t);
  const uid = 'fpperm1';
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
  fs.mkdirSync(path.join(config.storageRoot, pdfId, 'pages'), { recursive: true });
}

function insertPoll(pdfId: string): number {
  const t = nowIso();
  const result = db
    .prepare(`INSERT INTO page_polls (pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at) VALUES (?, 1, 'Q?', '["A","B"]', 1, 1, ?, ?)`)
    .run(pdfId, t, t);
  return Number(result.lastInsertRowid);
}

// --- figures/selection ---

test('PUT /figures/selection rejects a non-owner request on a read-only shared presentation', async () => {
  seedPermPdf('fpperm-figsel-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'PUT',
    url: '/api/pdfs/fpperm-figsel-readonly-01/pages/1/figures/selection',
    headers: OTHER_HEADERS,
    payload: { excluded: ['fig-1'] },
  });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('PUT /figures/selection allows the owner and a public_editable collaborator', async () => {
  seedPermPdf('fpperm-figsel-owner-01', 'private');
  const app = await buildApp();
  const ownerResp = await app.inject({
    method: 'PUT',
    url: '/api/pdfs/fpperm-figsel-owner-01/pages/1/figures/selection',
    headers: OWNER_HEADERS,
    payload: { excluded: ['fig-1'] },
  });
  assert.equal(ownerResp.statusCode, 200);

  seedPermPdf('fpperm-figsel-editable-01', 'public_editable');
  const editableResp = await app.inject({
    method: 'PUT',
    url: '/api/pdfs/fpperm-figsel-editable-01/pages/1/figures/selection',
    headers: OTHER_HEADERS,
    payload: { excluded: [] },
  });
  assert.equal(editableResp.statusCode, 200);
  await app.close();
});

// --- polls: create ---

test('POST /pages/:n/polls rejects a non-owner request on a read-only shared presentation', async () => {
  seedPermPdf('fpperm-pollcreate-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/fpperm-pollcreate-readonly-01/pages/1/polls',
    headers: OTHER_HEADERS,
    payload: { question: 'Q?', options: ['A', 'B'] },
  });
  assert.equal(resp.statusCode, 403);
  const count = db.prepare(`SELECT COUNT(*) AS c FROM page_polls WHERE pdf_id = ?`).get('fpperm-pollcreate-readonly-01') as { c: number };
  assert.equal(count.c, 0);
  await app.close();
});

test('POST /pages/:n/polls allows the owner to create a poll', async () => {
  seedPermPdf('fpperm-pollcreate-owner-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/fpperm-pollcreate-owner-01/pages/1/polls',
    headers: OWNER_HEADERS,
    payload: { question: 'Q?', options: ['A', 'B'] },
  });
  assert.equal(resp.statusCode, 201);
  await app.close();
});

// --- polls: delete ---

test('DELETE /polls/:pollId rejects a non-owner request and allows the owner', async () => {
  seedPermPdf('fpperm-polldelete-01', 'public');
  const pollId = insertPoll('fpperm-polldelete-01');
  const app = await buildApp();

  const forbidden = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/fpperm-polldelete-01/polls/${pollId}`,
    headers: OTHER_HEADERS,
  });
  assert.equal(forbidden.statusCode, 403);
  const stillThere = db.prepare(`SELECT id FROM page_polls WHERE id = ?`).get(pollId);
  assert.notEqual(stillThere, undefined);

  const allowed = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/fpperm-polldelete-01/polls/${pollId}`,
    headers: OWNER_HEADERS,
  });
  assert.equal(allowed.statusCode, 204);
  const gone = db.prepare(`SELECT id FROM page_polls WHERE id = ?`).get(pollId);
  assert.equal(gone, undefined);
  await app.close();
});

test('DELETE /polls/:pollId rejects a fully anonymous request (no session cookie) on a public_editable presentation', async () => {
  seedPermPdf('fpperm-polldel-edit-anon-01', 'public_editable');
  const pollId = insertPoll('fpperm-polldel-edit-anon-01');
  const app = await buildApp();

  // No `headers` at all: a visitor who never logged in and holds no share token, just knows the
  // pdf id and a poll id. public_editable is meant to let signed-in collaborators edit content
  // (and POST /polls/:pollId/votes intentionally stays open to any reader so classroom viewers can
  // vote), but deleting the whole poll is a different, destructive tier of action that must not
  // be reachable anonymously.
  const resp = await app.inject({ method: 'DELETE', url: `/api/pdfs/fpperm-polldel-edit-anon-01/polls/${pollId}` });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  const stillThere = db.prepare(`SELECT id FROM page_polls WHERE id = ?`).get(pollId);
  assert.notEqual(stillThere, undefined);

  await app.close();
});

test('DELETE /polls/:pollId allows a read-write collaborator on a public_editable presentation', async () => {
  seedPermPdf('fpperm-polldel-edit-collab-01', 'public_editable');
  const pollId = insertPoll('fpperm-polldel-edit-collab-01');
  const app = await buildApp();

  const resp = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/fpperm-polldel-edit-collab-01/polls/${pollId}`,
    headers: OTHER_HEADERS,
  });
  assert.equal(resp.statusCode, 204);
  const gone = db.prepare(`SELECT id FROM page_polls WHERE id = ?`).get(pollId);
  assert.equal(gone, undefined);

  await app.close();
});

// --- polls: reset-votes ---

test('POST /polls/:pollId/reset-votes rejects a non-owner request and allows the owner', async () => {
  seedPermPdf('fpperm-pollreset-01', 'public');
  const pollId = insertPoll('fpperm-pollreset-01');
  db.prepare(`INSERT INTO page_poll_votes (poll_id, voter_id, option_index, created_at, updated_at) VALUES (?, 'voter-1', 0, ?, ?)`)
    .run(pollId, nowIso(), nowIso());
  const app = await buildApp();

  const forbidden = await app.inject({
    method: 'POST',
    url: `/api/pdfs/fpperm-pollreset-01/polls/${pollId}/reset-votes`,
    headers: OTHER_HEADERS_NO_BODY,
  });
  assert.equal(forbidden.statusCode, 403);
  const stillVoted = db.prepare(`SELECT COUNT(*) AS c FROM page_poll_votes WHERE poll_id = ?`).get(pollId) as { c: number };
  assert.equal(stillVoted.c, 1);

  const allowed = await app.inject({
    method: 'POST',
    url: `/api/pdfs/fpperm-pollreset-01/polls/${pollId}/reset-votes`,
    headers: OWNER_HEADERS_NO_BODY,
  });
  assert.equal(allowed.statusCode, 200);
  const cleared = db.prepare(`SELECT COUNT(*) AS c FROM page_poll_votes WHERE poll_id = ?`).get(pollId) as { c: number };
  assert.equal(cleared.c, 0);
  await app.close();
});

test('POST /polls/:pollId/reset-votes rejects a fully anonymous request (no session cookie) on a public_editable presentation', async () => {
  seedPermPdf('fpperm-pollrst-edit-anon-01', 'public_editable');
  const pollId = insertPoll('fpperm-pollrst-edit-anon-01');
  db.prepare(`INSERT INTO page_poll_votes (poll_id, voter_id, option_index, created_at, updated_at) VALUES (?, 'voter-1', 0, ?, ?)`)
    .run(pollId, nowIso(), nowIso());
  const app = await buildApp();

  // No `headers` at all. Resetting every participant's submitted vote is a destructive,
  // irreversible action distinct from submitting a vote (which intentionally stays open to any
  // reader); it must require an authenticated session even on a public_editable presentation.
  const resp = await app.inject({ method: 'POST', url: `/api/pdfs/fpperm-pollrst-edit-anon-01/polls/${pollId}/reset-votes` });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  const stillVoted = db.prepare(`SELECT COUNT(*) AS c FROM page_poll_votes WHERE poll_id = ?`).get(pollId) as { c: number };
  assert.equal(stillVoted.c, 1);

  await app.close();
});

test('POST /polls/:pollId/reset-votes allows a read-write collaborator on a public_editable presentation', async () => {
  seedPermPdf('fpperm-pollrst-edit-collab-01', 'public_editable');
  const pollId = insertPoll('fpperm-pollrst-edit-collab-01');
  db.prepare(`INSERT INTO page_poll_votes (poll_id, voter_id, option_index, created_at, updated_at) VALUES (?, 'voter-1', 0, ?, ?)`)
    .run(pollId, nowIso(), nowIso());
  const app = await buildApp();

  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/fpperm-pollrst-edit-collab-01/polls/${pollId}/reset-votes`,
    headers: OTHER_HEADERS_NO_BODY,
  });
  assert.equal(resp.statusCode, 200);
  const cleared = db.prepare(`SELECT COUNT(*) AS c FROM page_poll_votes WHERE poll_id = ?`).get(pollId) as { c: number };
  assert.equal(cleared.c, 0);

  await app.close();
});

// --- polls: votes stays open ---

test('POST /polls/:pollId/votes is not gated by edit permission so followers can vote', async () => {
  seedPermPdf('fpperm-pollvote-01', 'public');
  const pollId = insertPoll('fpperm-pollvote-01');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/fpperm-pollvote-01/polls/${pollId}/votes`,
    headers: OTHER_HEADERS,
    payload: { voter_id: 'voter-1', option_index: 0 },
  });
  assert.equal(resp.statusCode, 200);
  await app.close();
});

test('POST /polls/:pollId/votes still requires at least read access to a private presentation', async () => {
  seedPermPdf('fpperm-pollvote-readperm-01', 'private');
  const pollId = insertPoll('fpperm-pollvote-readperm-01');
  const app = await buildApp();
  try {
    const noAccess = await app.inject({
      method: 'POST',
      url: `/api/pdfs/fpperm-pollvote-readperm-01/polls/${pollId}/votes`,
      headers: OTHER_HEADERS,
      payload: { voter_id: 'voter-1', option_index: 0 },
    });
    assert.equal(noAccess.statusCode, 403);
    assert.equal((noAccess.json() as { error: { code: string } }).error.code, 'FORBIDDEN');

    const ownerVote = await app.inject({
      method: 'POST',
      url: `/api/pdfs/fpperm-pollvote-readperm-01/polls/${pollId}/votes`,
      headers: OWNER_HEADERS,
      payload: { voter_id: 'voter-1', option_index: 0 },
    });
    assert.equal(ownerVote.statusCode, 200);
  } finally {
    await app.close();
  }
});
