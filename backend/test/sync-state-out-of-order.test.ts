import test from 'node:test';
import assert from 'node:assert/strict';
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

// PlayPage pushes /sync/state from three independent, concurrent sources (the page/playback
// effect, the throttled drawing push, and the throttled cursor push) for the same client_id.
// The network does not guarantee these arrive at the server in the order they were sent. These
// tests confirm: (1) without a seq, a request that was actually sent earlier but happens to
// arrive later still overwrites newer state (documenting the bug class), and (2) with seq
// (as the real frontend now always sends), the stale, late-arriving request is ignored instead
// of corrupting the session.

test('POST /sync/state: without seq, a late-arriving but earlier-sent push overwrites newer state (pre-fix behavior)', async () => {
  const pdfId = 'syncstate-noseq-overwrite-01';
  seedSyncPdf(pdfId);
  const app = await buildApp();
  try {
    await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/join`, headers: OWNER_HEADERS, payload: { client_id: 'master-1' } });

    // "new" push (page 3) is sent second by the client but arrives at the server first.
    const newArrivesFirst = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/state`,
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-1', page_number: 3, is_playing: true, current_time: 20 },
    });
    assert.equal(newArrivesFirst.statusCode, 200);

    // "old" push (page 2) was sent first by the client but arrives late.
    const oldArrivesLate = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/state`,
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-1', page_number: 2, is_playing: true, current_time: 10 },
    });
    assert.equal(oldArrivesLate.statusCode, 200);

    const state = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/sync/state` });
    const body = state.json() as { page_number: number; current_time: number };
    // Without seq, the late-arriving stale push wins — this is the bug being fixed for callers
    // that do supply seq.
    assert.equal(body.page_number, 2);
    assert.equal(body.current_time, 10);
  } finally {
    await app.close();
  }
});

test('POST /sync/state: with seq, a late-arriving but earlier-sent push is ignored instead of overwriting newer state', async () => {
  const pdfId = 'syncstate-seq-ignore-stale-01';
  seedSyncPdf(pdfId);
  const app = await buildApp();
  try {
    await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/join`, headers: OWNER_HEADERS, payload: { client_id: 'master-1' } });

    // "new" push (page 3, seq 2) sent second by the client, arrives first.
    const newArrivesFirst = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/state`,
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-1', page_number: 3, is_playing: true, current_time: 20, seq: 2 },
    });
    assert.equal(newArrivesFirst.statusCode, 200);

    // "old" push (page 2, seq 1) was sent first by the client, arrives late.
    const oldArrivesLate = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/state`,
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-1', page_number: 2, is_playing: true, current_time: 10, seq: 1 },
    });
    assert.equal(oldArrivesLate.statusCode, 200);

    const state = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/sync/state` });
    const body = state.json() as { page_number: number; current_time: number };
    // With seq, the stale push is ignored and the newer state (page 3) is preserved.
    assert.equal(body.page_number, 3);
    assert.equal(body.current_time, 20);
  } finally {
    await app.close();
  }
});

test('POST /sync/state: pushes with increasing seq in the correct arrival order all apply normally', async () => {
  const pdfId = 'syncstate-seq-normal-order-01';
  seedSyncPdf(pdfId);
  const app = await buildApp();
  try {
    await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/join`, headers: OWNER_HEADERS, payload: { client_id: 'master-1' } });

    for (let seq = 1; seq <= 3; seq += 1) {
      const resp = await app.inject({
        method: 'POST',
        url: `/api/pdfs/${pdfId}/sync/state`,
        headers: OWNER_HEADERS,
        payload: { client_id: 'master-1', page_number: seq, is_playing: true, current_time: seq * 10, seq },
      });
      assert.equal(resp.statusCode, 200);
    }

    const state = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/sync/state` });
    const body = state.json() as { page_number: number; current_time: number };
    assert.equal(body.page_number, 3);
    assert.equal(body.current_time, 30);
  } finally {
    await app.close();
  }
});

test('POST /sync/state: a newly claimed master is not blocked by the previous master\'s leftover seq counter', async () => {
  const pdfId = 'syncstate-seq-reset-01';
  seedSyncPdf(pdfId);
  const app = await buildApp();
  try {
    // First master pushes with a high seq, then leaves.
    await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/join`, headers: OWNER_HEADERS, payload: { client_id: 'master-1' } });
    await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/state`,
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-1', page_number: 5, is_playing: true, current_time: 50, seq: 99 },
    });
    await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/leave`, headers: OWNER_HEADERS, payload: { client_id: 'master-1' } });

    // A new master claims control and starts its own seq counter from 1 — must not be treated
    // as stale just because the previous master's counter had reached 99.
    await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/sync/join`, headers: OWNER_HEADERS, payload: { client_id: 'master-2' } });
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/sync/state`,
      headers: OWNER_HEADERS,
      payload: { client_id: 'master-2', page_number: 1, is_playing: false, current_time: 0, seq: 1 },
    });
    assert.equal(resp.statusCode, 200);

    const state = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/sync/state` });
    const body = state.json() as { page_number: number };
    assert.equal(body.page_number, 1);
  } finally {
    await app.close();
  }
});
