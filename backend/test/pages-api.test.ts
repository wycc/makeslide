import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { normalizeErrorCode } from '../src/errors';
import { setSystemAuthSettings } from '../src/services/aiSettings';

const PDF_ID = 'test-pages-api-01';
const SESSION_COOKIE =
  'eyJwcm92aWRlciI6Imdvb2dsZSIsInN1YiI6ImFjY291bnQtMSIsImVtYWlsIjoiYWNjb3VudC0xQGV4YW1wbGUuY29tIn0.mDkylBa8ZqLOib7FEOYl6YtwwODNJwieo4kUfAIIimw';

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function assertDeckAligned(pdfId: string): void {
  const rows = db
    .prepare(
      `SELECT page_number,image_path,text_path,script_path,audio_path
       FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
    )
    .all(pdfId) as Array<{
    page_number: number;
    image_path: string;
    text_path: string;
    script_path: string;
    audio_path: string | null;
  }>;
  for (const r of rows) {
    const p = String(r.page_number).padStart(3, '0');
    assert.equal(r.image_path, `pages/${p}.png`);
    assert.equal(r.text_path, `pages/${p}.text.txt`);
    assert.equal(r.script_path, `pages/${p}.script.txt`);
    if (r.audio_path) assert.equal(r.audio_path, `pages/${p}.mp3`);
  }
}

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
    const p = String(i).padStart(3, '0');
    const image = `pages/${p}.png`;
    const text = `pages/${p}.text.txt`;
    const script = `pages/${p}.script.txt`;
    const audio = `pages/${p}.mp3`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, i, image, text, script, audio, t, t);
    fs.writeFileSync(path.join(pagesDir, `${p}.png`), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(pagesDir, `${p}.text.txt`), `text-${i}`, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${p}.script.txt`), `script-${i}`, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${p}.mp3`), Buffer.from([0x49, 0x44, 0x33]));
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

test('GET /api/pdfs should not list presentations without an owner account', async () => {
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
  assert.deepEqual(
    items.filter((item) => item.id.startsWith('list-')).map((item) => item.id).sort(),
    ['list-owned-01', 'list-public-01'],
  );

  await app.close();
});

test('GET /api/pdfs/:id should deny presentations without an owner account', async () => {
  seedListPdf('detail-orphan-01', 'orphan detail', null);

  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/detail-orphan-01',
    headers: { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` },
  });

  assert.equal(resp.statusCode, 403);

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
  for (const r of rows) {
    const p = String(r.page_number).padStart(3, '0');
    assert.equal(r.image_path, `pages/${p}.png`);
    assert.equal(r.text_path, `pages/${p}.text.txt`);
    assert.equal(r.script_path, `pages/${p}.script.txt`);
    if (r.audio_path) assert.equal(r.audio_path, `pages/${p}.mp3`);
  }
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

  // Deleted page artifacts must be removed together.
  assert.equal(fs.existsSync(path.join(pagesDir, '004.png')), false);
  assert.equal(fs.existsSync(path.join(pagesDir, '004.text.txt')), false);
  assert.equal(fs.existsSync(path.join(pagesDir, '004.script.txt')), false);
  assert.equal(fs.existsSync(path.join(pagesDir, '004.mp3')), false);

  const rows = db
    .prepare(`SELECT page_number,image_path,text_path,script_path,audio_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(PDF_ID) as Array<{ page_number: number; image_path: string; text_path: string; script_path: string; audio_path: string | null }>;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.page_number), [1, 2, 3]);
  for (const r of rows) {
    const p = String(r.page_number).padStart(3, '0');
    assert.equal(r.image_path, `pages/${p}.png`);
    assert.equal(r.text_path, `pages/${p}.text.txt`);
    assert.equal(r.script_path, `pages/${p}.script.txt`);
    if (r.audio_path) assert.equal(r.audio_path, `pages/${p}.mp3`);
  }
  await app.close();
});

test('DELETE /api/pdfs/:id/pages/:n should succeed even when some artifact files are already missing', async () => {
  seedReadyPdfFor(PDF_ID, 4);
  const app = await buildApp();
  const pagesDir = path.join(config.storageRoot, PDF_ID, 'pages');

  // Simulate partially missing artifacts before delete.
  fs.rmSync(path.join(pagesDir, '002.mp3'), { force: true });
  fs.rmSync(path.join(pagesDir, '002.script.txt'), { force: true });

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

  // Make script contents deterministic for identity check.
  for (let i = 1; i <= 5; i++) {
    const p = String(i).padStart(3, '0');
    fs.writeFileSync(path.join(pagesDir, `${p}.script.txt`), String(i), 'utf8');
  }

  const resp = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/${PDF_ID}/pages/3`,
  });
  assert.equal(resp.statusCode, 200);

  // Original script "3" should be deleted.
  assert.equal(fs.existsSync(path.join(pagesDir, '005.script.txt')), false);
  assert.equal(fs.readFileSync(path.join(pagesDir, '001.script.txt'), 'utf8'), '1');
  assert.equal(fs.readFileSync(path.join(pagesDir, '002.script.txt'), 'utf8'), '2');
  assert.equal(fs.readFileSync(path.join(pagesDir, '003.script.txt'), 'utf8'), '4');
  assert.equal(fs.readFileSync(path.join(pagesDir, '004.script.txt'), 'utf8'), '5');

  const rows = db
    .prepare(`SELECT page_number,script_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(PDF_ID) as Array<{ page_number: number; script_path: string }>;
  assert.deepEqual(rows.map((r) => r.page_number), [1, 2, 3, 4]);
  assert.deepEqual(
    rows.map((r) => r.script_path),
    ['pages/001.script.txt', 'pages/002.script.txt', 'pages/003.script.txt', 'pages/004.script.txt'],
  );

  await app.close();
});

test('create presentation then add/delete on different positions should remain correct', async () => {
  const app = await buildApp();

  const upload = await app.inject({
    method: 'POST',
    url: '/api/pdfs',
    headers: { 'content-type': 'multipart/form-data; boundary=----roo' },
    payload:
      '------roo\r\n' +
      'Content-Disposition: form-data; name="file"; filename="seed.txt"\r\n' +
      'Content-Type: text/plain\r\n\r\n' +
      'seed\r\n' +
      '------roo--\r\n',
  });
  assert.equal(upload.statusCode, 201);
  const created = upload.json() as { id: string };
  const id = created.id;

  seedReadyPdfFor(id, 5);

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

  const sharedDetailAfterLeaveResp = await app.inject({
    method: 'GET',
    url: `/api/pdfs/${pdfId}?share=${encodeURIComponent(share.token)}`,
  });
  assert.equal(sharedDetailAfterLeaveResp.statusCode, 403);

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
