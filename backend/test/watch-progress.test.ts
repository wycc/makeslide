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
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedWatchProgressPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable' = 'public'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM page_watch_progress WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, visibility, t, t);
}

function reportPayload(overrides: Partial<{
  viewer_id: string;
  listened_ms: number;
  tab_hidden_ms: number;
  duration_ms: number | null;
  completed: boolean;
}> = {}) {
  return {
    viewer_id: 'viewer-1',
    listened_ms: 1000,
    tab_hidden_ms: 0,
    duration_ms: 10000,
    completed: false,
    ...overrides,
  };
}

test('POST /pages/:n/watch-progress rejects a request with no read access to a private presentation', async () => {
  seedWatchProgressPdf('wp-readperm-01', 'private');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/wp-readperm-01/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload(),
    });
    assert.equal(resp.statusCode, 403);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
    const count = db.prepare(`SELECT COUNT(*) AS c FROM page_watch_progress WHERE pdf_id = ?`).get('wp-readperm-01') as { c: number };
    assert.equal(count.c, 0);
  } finally {
    await app.close();
  }
});

test('POST /pages/:n/watch-progress succeeds for a reader and keeps the max of listened_ms/tab_hidden_ms across repeated reports', async () => {
  seedWatchProgressPdf('wp-report-01', 'public');
  const app = await buildApp();
  try {
    const first = await app.inject({
      method: 'POST',
      url: '/api/pdfs/wp-report-01/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload({ listened_ms: 8000, tab_hidden_ms: 500, duration_ms: 10000, completed: false }),
    });
    assert.equal(first.statusCode, 200);
    const firstBody = first.json() as { listened_ms: number; tab_hidden_ms: number };
    assert.equal(firstBody.listened_ms, 8000);
    assert.equal(firstBody.tab_hidden_ms, 500);

    // A later, smaller report (e.g. the viewer briefly left and re-entered the page,
    // resetting their locally-accumulated counters) must not overwrite the larger
    // values already persisted.
    const second = await app.inject({
      method: 'POST',
      url: '/api/pdfs/wp-report-01/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload({ listened_ms: 2000, tab_hidden_ms: 100, duration_ms: 10000, completed: false }),
    });
    assert.equal(second.statusCode, 200);
    const secondBody = second.json() as { listened_ms: number; tab_hidden_ms: number };
    assert.equal(secondBody.listened_ms, 8000);
    assert.equal(secondBody.tab_hidden_ms, 500);

    const row = db
      .prepare(`SELECT listened_ms, tab_hidden_ms FROM page_watch_progress WHERE pdf_id = ? AND page_number = 1 AND viewer_id = 'viewer-1'`)
      .get('wp-report-01') as { listened_ms: number; tab_hidden_ms: number };
    assert.equal(row.listened_ms, 8000);
    assert.equal(row.tab_hidden_ms, 500);
  } finally {
    await app.close();
  }
});

test('POST /pages/:n/watch-progress never lets completed go back to false once it has been true', async () => {
  seedWatchProgressPdf('wp-completed-01', 'public');
  const app = await buildApp();
  try {
    const first = await app.inject({
      method: 'POST',
      url: '/api/pdfs/wp-completed-01/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload({ listened_ms: 9500, tab_hidden_ms: 0, duration_ms: 10000, completed: true }),
    });
    assert.equal(first.statusCode, 200);
    assert.equal((first.json() as { completed: boolean }).completed, true);

    // A subsequent report for the same page/viewer claims completed: false (e.g. a
    // partial re-report before the next page's evaluation runs) — the previously
    // recorded "completed" must stick.
    const second = await app.inject({
      method: 'POST',
      url: '/api/pdfs/wp-completed-01/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload({ listened_ms: 9600, tab_hidden_ms: 0, duration_ms: 10000, completed: false }),
    });
    assert.equal(second.statusCode, 200);
    assert.equal((second.json() as { completed: boolean }).completed, true);

    const row = db
      .prepare(`SELECT completed FROM page_watch_progress WHERE pdf_id = ? AND page_number = 1 AND viewer_id = 'viewer-1'`)
      .get('wp-completed-01') as { completed: number };
    assert.equal(row.completed, 1);
  } finally {
    await app.close();
  }
});

test('GET /watch-progress rejects a non-owner/editor and returns correct aggregates for the owner', async () => {
  seedWatchProgressPdf('wp-stats-01', 'public');
  const app = await buildApp();
  try {
    // viewer-1: completed page 1
    await app.inject({
      method: 'POST',
      url: '/api/pdfs/wp-stats-01/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload({ viewer_id: 'viewer-1', listened_ms: 9000, tab_hidden_ms: 0, duration_ms: 10000, completed: true }),
    });
    // viewer-2: did not complete page 1
    await app.inject({
      method: 'POST',
      url: '/api/pdfs/wp-stats-01/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload({ viewer_id: 'viewer-2', listened_ms: 3000, tab_hidden_ms: 0, duration_ms: 10000, completed: false }),
    });

    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/pdfs/wp-stats-01/watch-progress',
      headers: OTHER_HEADERS,
    });
    assert.equal(forbidden.statusCode, 403);

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/pdfs/wp-stats-01/watch-progress',
      headers: OWNER_HEADERS,
    });
    assert.equal(allowed.statusCode, 200);
    const body = allowed.json() as {
      pages: Array<{ page_number: number; total_viewers: number; completed_viewers: number; avg_listened_ratio: number | null }>;
    };
    assert.equal(body.pages.length, 1);
    const page1 = body.pages[0];
    assert.equal(page1.page_number, 1);
    assert.equal(page1.total_viewers, 2);
    assert.equal(page1.completed_viewers, 1);
    assert.ok(page1.avg_listened_ratio !== null);
    assert.ok(Math.abs((page1.avg_listened_ratio ?? 0) - 0.6) < 1e-6);
  } finally {
    await app.close();
  }
});

test('GET /watch-progress caps each viewer\'s listened ratio at 1.0 so replaying audio cannot push the average above 100%', async () => {
  seedWatchProgressPdf('wp-cap-ratio-01', 'public');
  const app = await buildApp();
  try {
    // viewer-1 replayed a 10s clip three times in a row: the frontend's tick-based
    // listened_ms counter (see frontend/src/pages/play/useWatchProgress.ts) has no
    // cap relative to duration_ms, so listened_ms can legitimately reach 30000ms for
    // a 10000ms clip. Without capping the per-row ratio before averaging, this single
    // viewer would push avg_listened_ratio to 3 (300%).
    await app.inject({
      method: 'POST',
      url: '/api/pdfs/wp-cap-ratio-01/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload({ viewer_id: 'viewer-1', listened_ms: 30000, tab_hidden_ms: 0, duration_ms: 10000, completed: true }),
    });
    // viewer-2 listened to exactly half the clip, to also exercise averaging across
    // a capped row (1.0) and an uncapped row (0.5): expected average is 0.75, not 1.75.
    await app.inject({
      method: 'POST',
      url: '/api/pdfs/wp-cap-ratio-01/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload({ viewer_id: 'viewer-2', listened_ms: 5000, tab_hidden_ms: 0, duration_ms: 10000, completed: false }),
    });

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/pdfs/wp-cap-ratio-01/watch-progress',
      headers: OWNER_HEADERS,
    });
    assert.equal(allowed.statusCode, 200);
    const body = allowed.json() as {
      pages: Array<{ page_number: number; total_viewers: number; avg_listened_ratio: number | null }>;
    };
    const page1 = body.pages[0];
    assert.equal(page1.total_viewers, 2);
    assert.ok(page1.avg_listened_ratio !== null);
    assert.ok(
      (page1.avg_listened_ratio ?? 0) <= 1,
      `avg_listened_ratio must never exceed 1.0, got ${page1.avg_listened_ratio}`,
    );
    assert.ok(Math.abs((page1.avg_listened_ratio ?? 0) - 0.75) < 1e-6);
  } finally {
    await app.close();
  }
});

test('DELETE /watch-progress resets all progress rows and returns deleted_rows count (200), 403 for non-owner, 404 for missing', async () => {
  seedWatchProgressPdf('wp-reset-01', 'public');
  const app = await buildApp();
  try {
    await app.inject({
      method: 'POST',
      url: '/api/pdfs/wp-reset-01/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload({ viewer_id: 'viewer-1', listened_ms: 5000, tab_hidden_ms: 0, duration_ms: 10000, completed: false }),
    });

    const forbidden = await app.inject({ method: 'DELETE', url: '/api/pdfs/wp-reset-01/watch-progress', headers: OTHER_HEADERS });
    assert.equal(forbidden.statusCode, 403);

    const notFound = await app.inject({ method: 'DELETE', url: '/api/pdfs/does-not-exist-wp/watch-progress', headers: OWNER_HEADERS });
    assert.equal(notFound.statusCode, 404);

    const ok = await app.inject({ method: 'DELETE', url: '/api/pdfs/wp-reset-01/watch-progress', headers: OWNER_HEADERS });
    assert.equal(ok.statusCode, 200);
    const body = ok.json() as { ok: boolean; deleted_rows: number };
    assert.equal(body.ok, true);
    assert.equal(body.deleted_rows, 1);

    const count = db.prepare(`SELECT COUNT(*) AS c FROM page_watch_progress WHERE pdf_id = ?`).get('wp-reset-01') as { c: number };
    assert.equal(count.c, 0);
  } finally {
    await app.close();
  }
});

test('POST /pages/:n/watch-progress returns 404 for an unknown pdf and 400 for an invalid body', async () => {
  seedWatchProgressPdf('wp-misc-01', 'public');
  const app = await buildApp();
  try {
    const notFound = await app.inject({
      method: 'POST',
      url: '/api/pdfs/does-not-exist-1/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload(),
    });
    assert.equal(notFound.statusCode, 404);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/pdfs/wp-misc-01/pages/1/watch-progress',
      headers: OTHER_HEADERS,
      payload: reportPayload({ listened_ms: -1 }),
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
  }
});

function insertWatchRow(pdfId: string, pageNumber: number, viewerId: string, opts: { listened_ms?: number; duration_ms?: number | null; completed?: boolean } = {}): void {
  const t = nowIso();
  db.prepare(
    `INSERT INTO page_watch_progress (pdf_id, page_number, viewer_id, listened_ms, tab_hidden_ms, duration_ms, completed, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(pdfId, pageNumber, viewerId, opts.listened_ms ?? 0, 0, opts.duration_ms ?? 10000, opts.completed ? 1 : 0, t);
}

test('GET /watch-progress/details returns per-viewer rows for the owner', async () => {
  seedWatchProgressPdf('wp-details-01', 'public');
  insertWatchRow('wp-details-01', 1, 'alice', { listened_ms: 9000, completed: true });
  insertWatchRow('wp-details-01', 2, 'alice', { listened_ms: 3000, completed: false });
  insertWatchRow('wp-details-01', 1, 'bob', { listened_ms: 1000, completed: false });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs/wp-details-01/watch-progress/details', headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200, `expected 200 but got ${resp.statusCode}: ${resp.body.slice(0, 200)}`);
    const body = resp.json() as { records: Array<{ viewer_id: string; page_number: number; completed: boolean }> };
    assert.equal(body.records.length, 3);
    const alice = body.records.filter((r) => r.viewer_id === 'alice');
    assert.equal(alice.length, 2);
    assert.equal(alice[0].completed, true);
  } finally {
    db.prepare(`DELETE FROM page_watch_progress WHERE pdf_id = ?`).run('wp-details-01');
    await app.close();
  }
});

test('GET /watch-progress/details?page=N restricts to a single slide', async () => {
  seedWatchProgressPdf('wp-details-02', 'public');
  insertWatchRow('wp-details-02', 1, 'alice');
  insertWatchRow('wp-details-02', 2, 'alice');
  insertWatchRow('wp-details-02', 2, 'bob');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs/wp-details-02/watch-progress/details?page=2', headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { records: Array<{ viewer_id: string; page_number: number }> };
    assert.equal(body.records.length, 2);
    assert.ok(body.records.every((r) => r.page_number === 2), 'only page 2 rows');
  } finally {
    db.prepare(`DELETE FROM page_watch_progress WHERE pdf_id = ?`).run('wp-details-02');
    await app.close();
  }
});

test('GET /watch-progress/details is forbidden for a non-editor (protects viewer identity)', async () => {
  seedWatchProgressPdf('wp-details-03', 'public');
  insertWatchRow('wp-details-03', 1, 'alice');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs/wp-details-03/watch-progress/details', headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 403);
  } finally {
    db.prepare(`DELETE FROM page_watch_progress WHERE pdf_id = ?`).run('wp-details-03');
    await app.close();
  }
});
