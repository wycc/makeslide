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

// pruneExpiredClients() runs on most sync endpoints and is the mechanism that reaps a
// client's bookkeeping once its 30s CLIENT_TTL_MS lapses without a graceful /sync/leave
// (e.g. the student's tab closed or the network dropped — the common case for disconnects).
// It already reaped `clients` and `quizProgress`, but `userCodes` and `followerAccess` were
// only ever deleted by the explicit /sync/leave path for a single client_id. Since most
// disconnects never call /sync/leave, those two maps grew without bound for as long as the
// in-memory session lived (i.e. until the PDF was deleted or the server restarted).
test('userCodes is pruned once a client times out without calling /sync/leave', async () => {
  seedSyncPdf('sync-prune-usercodes-01');
  const app = await buildApp();
  try {
    const join = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-prune-usercodes-01/sync/join',
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-1' },
    });
    assert.equal(join.statusCode, 200);

    const ask = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-prune-usercodes-01/sync/questions',
      payload: { client_id: 'follower-1', user_code: 'Alice', question: 'what is photosynthesis?' },
    });
    assert.equal(ask.statusCode, 201);

    const { __getSyncSessionForTest } = await import('../src/routes/pdfs/sync');
    const session = __getSyncSessionForTest('sync-prune-usercodes-01');
    assert.ok(session, 'in-memory session must exist after the requests above');
    assert.equal(session!.userCodes.get('follower-1'), 'Alice', 'sanity check: userCodes was populated');

    // Simulate the 30s CLIENT_TTL_MS lapsing without the follower ever calling /sync/leave
    // (tab closed / network dropped), instead of sleeping for real.
    session!.clients.set('follower-1', Date.now() - 1000);

    // Any request that touches the session runs pruneExpiredClients() as a side effect.
    const state = await app.inject({
      method: 'GET',
      url: '/api/pdfs/sync-prune-usercodes-01/sync/state?client_id=master-1',
    });
    assert.equal(state.statusCode, 200);

    assert.equal(session!.clients.has('follower-1'), false, 'sanity check: the client TTL bookkeeping itself is pruned');
    assert.equal(session!.userCodes.has('follower-1'), false, 'userCodes must be pruned alongside clients/quizProgress, not leak forever');
  } finally {
    await app.close();
  }
});

// Same leak, different map: followerAccess records that a client joined via a share link
// (as opposed to being the owner/collaborator). It is only ever deleted by the explicit
// /sync/leave path, so a share-link guest whose tab closes without leaving would otherwise
// sit in this map forever too.
test('followerAccess is pruned once a share-link guest times out without calling /sync/leave', async () => {
  seedSyncPdf('sync-prune-followeraccess-01');
  const t = nowIso();
  db.prepare(
    `INSERT INTO pdf_shares (token, pdf_id, access, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run('share-token-abcdefghijkl', 'sync-prune-followeraccess-01', 'read_only', t, t);
  const app = await buildApp();
  try {
    const join = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-prune-followeraccess-01/sync/join',
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-1' },
    });
    assert.equal(join.statusCode, 200);

    const shareJoin = await app.inject({
      method: 'POST',
      url: '/api/pdfs/sync-prune-followeraccess-01/sync/share-join',
      headers: { 'x-makeslide-share-token': 'share-token-abcdefghijkl' },
      payload: { client_id: 'guest-1' },
    });
    assert.equal(shareJoin.statusCode, 200);

    const { __getSyncSessionForTest } = await import('../src/routes/pdfs/sync');
    const session = __getSyncSessionForTest('sync-prune-followeraccess-01');
    assert.ok(session, 'in-memory session must exist after the requests above');
    assert.equal(session!.followerAccess.get('guest-1'), 'share', 'sanity check: followerAccess was populated');

    session!.clients.set('guest-1', Date.now() - 1000);

    const state = await app.inject({
      method: 'GET',
      url: '/api/pdfs/sync-prune-followeraccess-01/sync/state?client_id=master-1',
    });
    assert.equal(state.statusCode, 200);

    assert.equal(session!.clients.has('guest-1'), false, 'sanity check: the client TTL bookkeeping itself is pruned');
    assert.equal(
      session!.followerAccess.has('guest-1'),
      false,
      'followerAccess must be pruned alongside clients/quizProgress, not leak forever',
    );
  } finally {
    await app.close();
  }
});
