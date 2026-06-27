import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { normalizeErrorCode } from '../src/errors';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import crypto from 'node:crypto';

const PDF_ID = 'test-pages-api-01';
function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const SESSION_COOKIE = testSessionCookie('account-1');

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

// Page artifacts are keyed by each page's stable page_uid, NOT by its page
// number — inserting/deleting pages renumbers page_number but never renames
// files (see page-operations.ts). So the only deck-wide invariant after an
// insert/delete is that page_number stays contiguous 1..N.
function assertDeckAligned(pdfId: string): void {
  const rows = db
    .prepare(`SELECT page_number FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(pdfId) as Array<{ page_number: number }>;
  assert.deepEqual(
    rows.map((r) => r.page_number),
    Array.from({ length: rows.length }, (_, i) => i + 1),
  );
}

// Seed pages with stable uid-based paths (pages/u<i>.jpg, .text.txt, .script.txt,
// .m4a) matching the production storage scheme, and write the corresponding files.
function seedReadyPdfFor(pdfId: string, pageCount: number): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', pageCount, t, t);

  const pdfDir = path.join(config.storageRoot, pdfId);
  const pagesDir = path.join(pdfDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (let i = 1; i <= pageCount; i++) {
    const uid = `u${i}`;
    const image = `pages/${uid}.jpg`;
    const text = `pages/${uid}.text.txt`;
    const script = `pages/${uid}.script.txt`;
    const audio = `pages/${uid}.m4a`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, i, uid, image, text, script, audio, t, t);
    fs.writeFileSync(path.join(pagesDir, `${uid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
    fs.writeFileSync(path.join(pagesDir, `${uid}.text.txt`), `text-${i}`, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), `script-${i}`, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${uid}.m4a`), Buffer.from([0x00]));
  }
}

function seedListPdf(pdfId: string, title: string, ownerSub: string | null, visibility: 'private' | 'public' | 'public_editable' = 'private'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,?,?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, title, `${pdfId}.pdf`, ownerSub, visibility, t, t);
}

test('GET /api/pdfs omits ownerless presentations from the list, but still lists owned/public ones', async () => {
  seedListPdf('list-owned-01', 'owned', 'account-1');
  seedListPdf('list-orphan-01', 'orphan', null);
  seedListPdf('list-public-01', 'public', 'account-2', 'public');

  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs',
    headers: { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` },
  });

  assert.equal(resp.statusCode, 200);
  const items = resp.json() as Array<{ id: string }>;
  // 'list-orphan-01' has no owner_sub — still readable via GET /api/pdfs/:id (see the
  // "allows presentations without an owner account" test below), but deliberately left
  // out of the homepage list (see the ownerless-pdf hiding feature).
  assert.deepEqual(
    items.filter((item) => item.id.startsWith('list-')).map((item) => item.id).sort(),
    ['list-owned-01', 'list-public-01'],
  );

  await app.close();
});

test('POST /api/pdfs/:id/share should publish with per-presentation read-only/read-write visibility', async () => {
  seedListPdf('share-visibility-readonly-01', 'share ro', 'account-1', 'private');
  seedListPdf('share-visibility-editable-01', 'share rw', 'account-1', 'private');

  const app = await buildApp();
  const headers = { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` };
  const roResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/share-visibility-readonly-01/share',
    headers,
    payload: { access: 'read_only' },
  });
  assert.equal(roResp.statusCode, 200);
  assert.equal((roResp.json() as { visibility: string }).visibility, 'public');

  const rwResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/share-visibility-editable-01/share',
    headers,
    payload: { access: 'editable' },
  });
  assert.equal(rwResp.statusCode, 200);
  assert.equal((rwResp.json() as { visibility: string }).visibility, 'public_editable');

  const rows = db
    .prepare(`SELECT id, visibility FROM pdfs WHERE id IN (?, ?) ORDER BY id ASC`)
    .all('share-visibility-editable-01', 'share-visibility-readonly-01') as Array<{ id: string; visibility: string }>;
  assert.deepEqual(rows.map((row) => row.visibility).sort(), ['public', 'public_editable']);

  await app.close();
});

test('read-only shared presentations appear in other accounts list but reject edits', async () => {
  seedListPdf('share-list-private-01', 'private', 'account-2', 'private');
  seedListPdf('share-list-ro-01', 'read only shared', 'account-2', 'public');
  seedListPdf('share-list-rw-01', 'read write shared', 'account-2', 'public_editable');

  const app = await buildApp();
  const headers = { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` };
  const listResp = await app.inject({ method: 'GET', url: '/api/pdfs', headers });
  assert.equal(listResp.statusCode, 200);
  const ids = (listResp.json() as Array<{ id: string }>).map((item) => item.id).filter((id) => id.startsWith('share-list-')).sort();
  assert.deepEqual(ids, ['share-list-ro-01', 'share-list-rw-01']);

  const roEditResp = await app.inject({
    method: 'PATCH',
    url: '/api/pdfs/share-list-ro-01/title',
    headers,
    payload: { title: 'blocked' },
  });
  assert.equal(roEditResp.statusCode, 403);

  const rwEditResp = await app.inject({
    method: 'PATCH',
    url: '/api/pdfs/share-list-rw-01/title',
    headers,
    payload: { title: 'allowed' },
  });
  assert.equal(rwEditResp.statusCode, 200);

  await app.close();
});

test('GET /api/pdfs/:id allows presentations without an owner account (ownerless is readable by anyone, matching canEditPdf)', async () => {
  seedListPdf('detail-orphan-01', 'orphan detail', null);

  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/detail-orphan-01',
    headers: { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` },
  });

  assert.equal(resp.statusCode, 200);

  await app.close();
});

test('POST /api/pdfs/:id/pages should insert one page and keep path aligned', async () => {
  seedReadyPdfFor(PDF_ID, 3);
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${PDF_ID}/pages`,
    payload: { after_page_number: 1 },
  });
  assert.equal(resp.statusCode, 201);

  const rows = db
    .prepare(`SELECT page_number,image_path,text_path,script_path,audio_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(PDF_ID) as Array<{ page_number: number; image_path: string; text_path: string; script_path: string; audio_path: string | null }>;
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.page_number), [1, 2, 3, 4]);
  // Existing pages keep their stable uid-based paths (just renumbered); the newly
  // inserted page (now #2) has a fresh uid path, not one of the originals.
  assert.equal(rows[0].image_path, 'pages/u1.jpg');
  assert.equal(rows[2].image_path, 'pages/u2.jpg');
  assert.equal(rows[3].image_path, 'pages/u3.jpg');
  assert.match(rows[1].image_path, /^pages\/.+\.jpg$/);
  assert.ok(!['pages/u1.jpg', 'pages/u2.jpg', 'pages/u3.jpg'].includes(rows[1].image_path));
  await app.close();
});

test('POST /api/pdfs/:id/pages should insert at specified position (not always append)', async () => {
  seedReadyPdfFor(PDF_ID, 4);
  const app = await buildApp();

  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${PDF_ID}/pages`,
    payload: { after_page_number: 1 },
  });
  assert.equal(resp.statusCode, 201);
  const body = resp.json() as { id: string; page_number: number; page_count: number; updated_at: string };
  assert.equal(body.id, PDF_ID);
  assert.equal(body.page_number, 2);
  assert.equal(body.page_count, 5);

  const rows = db
    .prepare(`SELECT page_number,image_path,text_path,script_path,audio_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(PDF_ID) as Array<{ page_number: number; image_path: string; text_path: string; script_path: string; audio_path: string | null }>;
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.page_number), [1, 2, 3, 4, 5]);
  assertDeckAligned(PDF_ID);

  await app.close();
});

test('DELETE /api/pdfs/:id/pages/:n should delete correct page and compact numbering', async () => {
  seedReadyPdfFor(PDF_ID, 4);
  const app = await buildApp();
  const pagesDir = path.join(config.storageRoot, PDF_ID, 'pages');
  const resp = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/${PDF_ID}/pages/2`,
  });
  assert.equal(resp.statusCode, 200);

  // The deleted page (page 2 = uid u2) artifacts must be removed; survivors keep
  // their own uid files (no renaming).
  assert.equal(fs.existsSync(path.join(pagesDir, 'u2.jpg')), false);
  assert.equal(fs.existsSync(path.join(pagesDir, 'u2.text.txt')), false);
  assert.equal(fs.existsSync(path.join(pagesDir, 'u2.script.txt')), false);
  assert.equal(fs.existsSync(path.join(pagesDir, 'u2.m4a')), false);

  const rows = db
    .prepare(`SELECT page_number,image_path,text_path,script_path,audio_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(PDF_ID) as Array<{ page_number: number; image_path: string; text_path: string; script_path: string; audio_path: string | null }>;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.page_number), [1, 2, 3]);
  // Survivors (u1, u3, u4) keep their stable uid paths, compacted to 1..3.
  assert.deepEqual(rows.map((r) => r.image_path), ['pages/u1.jpg', 'pages/u3.jpg', 'pages/u4.jpg']);
  assert.deepEqual(rows.map((r) => r.script_path), ['pages/u1.script.txt', 'pages/u3.script.txt', 'pages/u4.script.txt']);
  await app.close();
});

test('DELETE /api/pdfs/:id/pages/:n should succeed even when some artifact files are already missing', async () => {
  seedReadyPdfFor(PDF_ID, 4);
  const app = await buildApp();
  const pagesDir = path.join(config.storageRoot, PDF_ID, 'pages');

  // Simulate partially missing artifacts (page 2 = uid u2) before delete.
  fs.rmSync(path.join(pagesDir, 'u2.m4a'), { force: true });
  fs.rmSync(path.join(pagesDir, 'u2.script.txt'), { force: true });

  const resp = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/${PDF_ID}/pages/2`,
  });
  assert.equal(resp.statusCode, 200);

  const body = resp.json() as { id: string; page_count: number; updated_at: string };
  assert.equal(body.id, PDF_ID);
  assert.equal(body.page_count, 3);
  assert.equal(typeof body.updated_at, 'string');

  const rows = db
    .prepare(`SELECT page_number,image_path,text_path,script_path,audio_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(PDF_ID) as Array<{ page_number: number; image_path: string; text_path: string; script_path: string; audio_path: string | null }>;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.page_number), [1, 2, 3]);
  assertDeckAligned(PDF_ID);

  await app.close();
});

test('DELETE /api/pdfs/:id/pages/:n should cancel running artifact timing for deleted page', async () => {
  seedReadyPdfFor(PDF_ID, 4);
  const startedAt = nowIso();
  const runId = 'delete-page-running-image-test';
  db.prepare(
    `INSERT INTO pipeline_runs
       (id, pdf_id, run_type, parent_run_id, triggered_by, status, attempt, started_at, created_at, updated_at)
     VALUES (?, ?, 'regenerate', NULL, 'test', 'running', 1, ?, ?, ?)`,
  ).run(runId, PDF_ID, startedAt, startedAt, startedAt);
  db.prepare(
    `INSERT INTO page_artifact_timings
       (pdf_id, page_number, artifact, run_id, attempt, reason, status, started_at, ended_at, duration_ms, sla_target_ms, sla_status, output_path, error_code, error_message, updated_at)
     VALUES (?, 2, 'image', ?, 1, 'regenerate', 'running', ?, NULL, NULL, 30000, 'unknown', NULL, NULL, NULL, ?)`,
  ).run(PDF_ID, runId, startedAt, startedAt);

  const app = await buildApp();
  const resp = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/${PDF_ID}/pages/2`,
  });
  assert.equal(resp.statusCode, 200);

  const timing = db
    .prepare(`SELECT status, ended_at, error_code, error_message FROM page_artifact_timings WHERE pdf_id = ? AND page_number = 2 AND artifact = 'image'`)
    .get(PDF_ID) as { status: string; ended_at: string | null; error_code: string | null; error_message: string | null };
  assert.equal(timing.status, 'canceled');
  assert.equal(typeof timing.ended_at, 'string');
  assert.equal(timing.error_code, 'PAGE_DELETED');
  assert.match(timing.error_message ?? '', /deleted/);
  assertDeckAligned(PDF_ID);

  await app.close();
});

test('DELETE /api/pdfs/:id/pages/:n should remove page by script content and compact correctly', async () => {
  seedReadyPdfFor(PDF_ID, 5);
  const app = await buildApp();
  const pagesDir = path.join(config.storageRoot, PDF_ID, 'pages');

  // Make script contents deterministic for identity check (keyed by stable uid).
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(path.join(pagesDir, `u${i}.script.txt`), String(i), 'utf8');
  }

  const resp = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/${PDF_ID}/pages/3`,
  });
  assert.equal(resp.statusCode, 200);

  // Page 3 (uid u3, content "3") is deleted; survivors keep their own uid files
  // and contents (no renaming), and compact to page_number 1..4.
  assert.equal(fs.existsSync(path.join(pagesDir, 'u3.script.txt')), false);
  assert.equal(fs.readFileSync(path.join(pagesDir, 'u1.script.txt'), 'utf8'), '1');
  assert.equal(fs.readFileSync(path.join(pagesDir, 'u2.script.txt'), 'utf8'), '2');
  assert.equal(fs.readFileSync(path.join(pagesDir, 'u4.script.txt'), 'utf8'), '4');
  assert.equal(fs.readFileSync(path.join(pagesDir, 'u5.script.txt'), 'utf8'), '5');

  const rows = db
    .prepare(`SELECT page_number,script_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(PDF_ID) as Array<{ page_number: number; script_path: string }>;
  assert.deepEqual(rows.map((r) => r.page_number), [1, 2, 3, 4]);
  assert.deepEqual(
    rows.map((r) => r.script_path),
    ['pages/u1.script.txt', 'pages/u2.script.txt', 'pages/u4.script.txt', 'pages/u5.script.txt'],
  );

  await app.close();
});

test('create presentation then add/delete on different positions should remain correct', async () => {
  // Seed a ready deck directly. (A previous version uploaded a real PDF first,
  // but its background pipeline raced with the manual seeding and left the deck
  // with non-contiguous page_numbers, which is an artificial state the delete
  // path is not meant to handle.)
  const id = 'test-pages-positions-01';
  seedReadyPdfFor(id, 5);
  const app = await buildApp();

  const addAtStart = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/pages`,
    payload: { after_page_number: 0 },
  });
  assert.equal(addAtStart.statusCode, 201);
  assertDeckAligned(id);

  const addInMiddle = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/pages`,
    payload: { after_page_number: 3 },
  });
  assert.equal(addInMiddle.statusCode, 201);
  assertDeckAligned(id);

  const addAtEnd = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/pages`,
    payload: { after_page_number: 7 },
  });
  assert.equal(addAtEnd.statusCode, 201);
  assertDeckAligned(id);

  const delStart = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/pages/1` });
  assert.equal(delStart.statusCode, 200);
  assertDeckAligned(id);

  const delMiddle = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/pages/4` });
  assert.equal(delMiddle.statusCode, 200);
  assertDeckAligned(id);

  const last = db.prepare(`SELECT page_count FROM pdfs WHERE id = ?`).get(id) as { page_count: number };
  const delEnd = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/pages/${last.page_count}` });
  assert.equal(delEnd.statusCode, 200);
  assertDeckAligned(id);

  await app.close();
});

test('DELETE /api/pdfs/:id should delete presentation, pages, timing rows and storage directory', async () => {
  const pdfId = 'test-delete-pdf-01';
  seedReadyPdfFor(pdfId, 2);
  const t = nowIso();
  const runId = `${pdfId}-run`;
  db.prepare(
    `INSERT INTO pipeline_runs (id,pdf_id,run_type,parent_run_id,triggered_by,status,attempt,started_at,created_at,updated_at)
     VALUES (?,?,?,NULL,?,?,?,?,?,?)`,
  ).run(runId, pdfId, 'initial', 'test', 'completed', 1, t, t, t);
  db.prepare(
    `INSERT INTO pipeline_stage_events (run_id,pdf_id,stage,event_type,attempt,occurred_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(runId, pdfId, 'text', 'completed', 1, t);
  db.prepare(
    `INSERT INTO pipeline_stage_summaries (run_id,pdf_id,stage,attempt,status,sla_status,updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(runId, pdfId, 'text', 1, 'completed', 'ok', t);
  db.prepare(
    `INSERT INTO page_artifact_events (run_id,pdf_id,page_number,artifact,event_type,attempt,reason,occurred_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(runId, pdfId, 1, 'text', 'completed', 1, 'test', t);
  db.prepare(
    `INSERT INTO page_artifact_timings (pdf_id,page_number,artifact,run_id,attempt,reason,status,sla_status,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(pdfId, 1, 'text', runId, 1, 'test', 'completed', 'ok', t);

  const pdfDir = path.join(config.storageRoot, pdfId);
  assert.equal(fs.existsSync(pdfDir), true);

  const app = await buildApp();
  const resp = await app.inject({ method: 'DELETE', url: `/api/pdfs/${pdfId}` });
  assert.equal(resp.statusCode, 204);
  assert.equal(resp.body, '');

  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM pdfs WHERE id = ?`).get(pdfId) as { c: number }).c, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM pages WHERE pdf_id = ?`).get(pdfId) as { c: number }).c, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM pipeline_runs WHERE pdf_id = ?`).get(pdfId) as { c: number }).c, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM pipeline_stage_events WHERE pdf_id = ?`).get(pdfId) as { c: number }).c, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM pipeline_stage_summaries WHERE pdf_id = ?`).get(pdfId) as { c: number }).c, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM page_artifact_events WHERE pdf_id = ?`).get(pdfId) as { c: number }).c, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM page_artifact_timings WHERE pdf_id = ?`).get(pdfId) as { c: number }).c, 0);
  assert.equal(fs.existsSync(pdfDir), false);

  await app.close();
});

test('DELETE /api/pdfs/:id should return PDF_NOT_FOUND for missing presentation', async () => {
  const app = await buildApp();
  const resp = await app.inject({ method: 'DELETE', url: '/api/pdfs/missing-pdf-01' });
  assert.equal(resp.statusCode, 404);
  assert.deepEqual(resp.json(), { error: { code: 'PDF_NOT_FOUND', message: 'PDF not found' } });
  await app.close();
});

test('shared sync join grants temporary follower access and revokes it when master leaves', async () => {
  const pdfId = 'test-shared-sync-01';
  seedReadyPdfFor(pdfId, 2);
  const app = await buildApp();

  const shareResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${pdfId}/share`,
    payload: { access: 'read_only' },
  });
  assert.equal(shareResp.statusCode, 200);
  const share = shareResp.json() as { token: string };

  const shareAgainResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${pdfId}/share`,
    payload: { access: 'read_only' },
  });
  assert.equal(shareAgainResp.statusCode, 200);
  assert.equal((shareAgainResp.json() as { token: string }).token, share.token);

  const inactiveResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${pdfId}/sync/share-join`,
    headers: { 'x-makeslide-share-token': share.token },
    payload: { client_id: 'follower-before-master' },
  });
  assert.equal(inactiveResp.statusCode, 409);
  assert.equal(inactiveResp.json().error.code, 'SYNC_NOT_ACTIVE');

  const masterResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${pdfId}/sync/join`,
    payload: { client_id: 'master-1' },
  });
  assert.equal(masterResp.statusCode, 200);
  assert.equal(masterResp.json().role, 'master');

  const followerResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${pdfId}/sync/share-join`,
    headers: { 'x-makeslide-share-token': share.token },
    payload: { client_id: 'shared-follower-1' },
  });
  assert.equal(followerResp.statusCode, 200);
  const follower = followerResp.json() as { role: string; master_client_id: string | null; user_code: string | null };
  assert.equal(follower.role, 'follower');
  assert.equal(follower.master_client_id, 'master-1');
  assert.equal(follower.user_code, null);

  const sharedDetailResp = await app.inject({
    method: 'GET',
    url: `/api/pdfs/${pdfId}?share=${encodeURIComponent(share.token)}`,
  });
  assert.equal(sharedDetailResp.statusCode, 200);

  const leaveResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${pdfId}/sync/leave`,
    payload: { client_id: 'master-1' },
  });
  assert.equal(leaveResp.statusCode, 200);

  const stateResp = await app.inject({
    method: 'GET',
    url: `/api/pdfs/${pdfId}/sync/state?client_id=shared-follower-1`,
  });
  assert.equal(stateResp.statusCode, 200);
  const state = stateResp.json() as { role: string; master_client_id: string | null };
  assert.equal(state.role, 'follower');
  assert.equal(state.master_client_id, null);

  const shareAfterLeaveResp = await app.inject({ method: 'GET', url: `/api/share/${share.token}` });
  assert.equal(shareAfterLeaveResp.statusCode, 404);

  // The earlier POST /share with `{ access: 'read_only' }` set this PDF's own `visibility`
  // column to 'public' (see accessToVisibility()) — a separate, persistent setting from the
  // share token itself, and revoking the token (above) does not reset it. So reading the PDF
  // after revocation still succeeds: not because the now-dead token still works, but because
  // the presentation is genuinely public at this point regardless of any token. (Before
  // canReadPdf() was fixed to treat ownerless presentations as readable, this assertion used to
  // expect 403 — but that only "worked" because the ownerless check short-circuited before ever
  // reaching the visibility check, masking the fact that visibility was already 'public'.)
  const sharedDetailAfterLeaveResp = await app.inject({
    method: 'GET',
    url: `/api/pdfs/${pdfId}?share=${encodeURIComponent(share.token)}`,
  });
  assert.equal(sharedDetailAfterLeaveResp.statusCode, 200);

  const nextShareResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${pdfId}/share`,
    payload: { access: 'read_only' },
  });
  assert.equal(nextShareResp.statusCode, 200);
  assert.notEqual((nextShareResp.json() as { token: string }).token, share.token);

  await app.close();
});
test('error code normalize: upload type', () => {
  assert.equal(normalizeErrorCode('INVALID_MIME'), 'INVALID_UPLOAD_TYPE');
});

test('error code normalize: url', () => {
  assert.equal(normalizeErrorCode('INVALID_YOUTUBE_URL'), 'INVALID_URL');
});

test('error code normalize: resource not found', () => {
  assert.equal(normalizeErrorCode('PAGE_AUDIO_NOT_FOUND'), 'RESOURCE_NOT_FOUND');
});

test('error code normalize: job conflict', () => {
  assert.equal(normalizeErrorCode('JOB_ALREADY_RUNNING'), 'JOB_CONFLICT');
});

test('error code normalize: pass through', () => {
  assert.equal(normalizeErrorCode('INTERNAL_ERROR'), 'INTERNAL_ERROR');
});
