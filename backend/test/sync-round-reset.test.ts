import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import crypto from 'node:crypto';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString(
    'base64url',
  );
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedSyncPdf(pdfId: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, t, t);
}

// resetSyncMode() runs whenever a sync round ends, either because the master explicitly
// calls /sync/leave, or because the master's TTL silently expires and the next request
// touches the session. It is supposed to wipe all per-round state (active quiz, AI answer,
// displayed question, quiz progress, follower access) before the next master starts a new
// round. follower_questions was missing from that reset list, so questions asked by students
// in a prior class session would still be sitting in the next class's question list.
test('follower questions from a finished sync round do not leak into the next round (master leaves and rejoins)', async () => {
  seedSyncPdf('sync-round-leave-01');
  const app = await buildApp();
  try {
    const join1 = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-round-leave-01/sync/join',
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-1' },
    });
    assert.equal(join1.statusCode, 200);

    const ask = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-round-leave-01/sync/questions',
      payload: { client_id: 'follower-1', question: 'round1 question: what is photosynthesis?' },
    });
    assert.equal(ask.statusCode, 201);

    const stateBeforeLeave = await app.inject({
      method: 'GET',
      url: '/api/pdfs/sync-round-leave-01/sync/state?client_id=master-1',
    });
    assert.equal(
      (stateBeforeLeave.json() as { follower_questions: unknown[] }).follower_questions.length,
      1,
      'sanity check: the question should be visible before the round ends',
    );

    const leave = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-round-leave-01/sync/leave',
      payload: { client_id: 'master-1' },
    });
    assert.equal(leave.statusCode, 200);

    const join2 = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-round-leave-01/sync/join',
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-2' },
    });
    assert.equal(join2.statusCode, 200);
    const body = join2.json() as { follower_questions: Array<{ question: string }> };
    assert.deepEqual(body.follower_questions, [], 'a fresh round must not inherit questions from the previous round');
  } finally {
    await app.close();
  }
});

// getSession() has a second resetSyncMode() call site: when an in-memory session is hit but
// its master TTL has already lapsed (e.g. the presenter's tab crashed instead of cleanly
// calling /sync/leave), the very next request that touches the session resets it in place.
// Reproduce that path directly without sleeping for the real 10-minute MASTER_TTL_MS by
// importing the session map module and backdating the in-memory expiry of the just-created
// session before the next /sync/join arrives.
test('follower questions do not leak into the next round when the previous master silently expires (in-process TTL lapse)', async () => {
  seedSyncPdf('sync-round-expire-01');
  const app = await buildApp();
  try {
    const join1 = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-round-expire-01/sync/join',
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-1' },
    });
    assert.equal(join1.statusCode, 200);

    const ask = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-round-expire-01/sync/questions',
      payload: { client_id: 'follower-1', question: 'round1 question: what is mitosis?' },
    });
    assert.equal(ask.statusCode, 201);

    const { hasInMemorySyncSession, __getSyncSessionForTest } = await import('../src/routes/pdfs/sync');
    assert.ok(hasInMemorySyncSession('sync-round-expire-01'));
    const liveSession = __getSyncSessionForTest('sync-round-expire-01');
    assert.ok(liveSession, 'the live in-memory session must exist after /sync/join');
    // Backdate the in-memory TTL directly: this is what "the master's tab crashed 10+
    // minutes ago" looks like from the server's point of view, without sleeping for real.
    liveSession!.masterExpiresAt = Date.now() - 1000;

    const join2 = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-round-expire-01/sync/join',
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-2' },
    });
    assert.equal(join2.statusCode, 200);
    const body = join2.json() as { follower_questions: Array<{ question: string }>; role: string };
    assert.equal(body.role, 'master');
    assert.deepEqual(body.follower_questions, [], 'a round restarted after master TTL lapse must not inherit prior questions');
  } finally {
    await app.close();
  }
});
