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

function seedDrawingPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable' = 'public'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM page_drawings WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, visibility, t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, 1, `${pdfId}-uid1`, `pages/${pdfId}-uid1.jpg`, `pages/${pdfId}-uid1.text.txt`, `pages/${pdfId}-uid1.script.txt`, t, t);
}

function seedShareToken(pdfId: string, token: string, access: 'read_only' | 'editable' = 'read_only'): void {
  const t = nowIso();
  db.prepare(`INSERT INTO pdf_shares (pdf_id, token, access, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(pdfId, token, access, t, t);
}

test('GET drawing returns null for an authorized missing drawing', async () => {
  seedDrawingPdf('drawing-get-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/drawing-get-01/pages/1/drawing',
    headers: OTHER_HEADERS,
  });
  assert.equal(resp.statusCode, 200);
  assert.equal((resp.json() as { drawing_json: string | null }).drawing_json, null);
  await app.close();
});

test('GET drawing rejects non-owner private reads, but allows owner and share token', async () => {
  const pdfId = 'drawing-get-permission-01';
  const token = 'drawing-share-token-01';
  seedDrawingPdf(pdfId, 'private');
  seedShareToken(pdfId, token, 'read_only');
  db.prepare(`INSERT OR REPLACE INTO page_drawings (pdf_id, page_number, drawing_json, updated_at) VALUES (?, 1, ?, ?)`).run(
    pdfId,
    '{"strokes":["private"]}',
    nowIso(),
  );
  const app = await buildApp();
  const forbidden = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/drawing`, headers: OTHER_HEADERS });
  assert.equal(forbidden.statusCode, 403);
  assert.equal((forbidden.json() as { error: { code: string } }).error.code, 'FORBIDDEN');

  const owner = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/drawing`, headers: OWNER_HEADERS });
  assert.equal(owner.statusCode, 200);
  assert.equal((owner.json() as { drawing_json: string | null }).drawing_json, '{"strokes":["private"]}');

  const shared = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/drawing?share=${token}` });
  assert.equal(shared.statusCode, 200);
  assert.equal((shared.json() as { drawing_json: string | null }).drawing_json, '{"strokes":["private"]}');
  await app.close();
});

test('PUT drawing rejects a non-owner request on a read-only shared presentation', async () => {
  seedDrawingPdf('drawing-put-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'PUT',
    url: '/api/pdfs/drawing-put-readonly-01/pages/1/drawing',
    headers: OTHER_HEADERS,
    payload: { drawing_json: '{"strokes":[]}' },
  });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  const row = db.prepare(`SELECT drawing_json FROM page_drawings WHERE pdf_id = ? AND page_number = 1`).get('drawing-put-readonly-01');
  assert.equal(row, undefined);
  await app.close();
});

test('PUT drawing rejects a non-owner request on a private presentation', async () => {
  seedDrawingPdf('drawing-put-private-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'PUT',
    url: '/api/pdfs/drawing-put-private-01/pages/1/drawing',
    headers: OTHER_HEADERS,
    payload: { drawing_json: '{"strokes":[]}' },
  });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('PUT drawing allows the owner and a read-write collaborator', async () => {
  seedDrawingPdf('drawing-put-owner-01', 'private');
  const app = await buildApp();
  const ownerResp = await app.inject({
    method: 'PUT',
    url: '/api/pdfs/drawing-put-owner-01/pages/1/drawing',
    headers: OWNER_HEADERS,
    payload: { drawing_json: '{"strokes":["a"]}' },
  });
  assert.equal(ownerResp.statusCode, 200);
  const row = db.prepare(`SELECT drawing_json FROM page_drawings WHERE pdf_id = ? AND page_number = 1`).get('drawing-put-owner-01') as { drawing_json: string };
  assert.equal(row.drawing_json, '{"strokes":["a"]}');

  seedDrawingPdf('drawing-put-editable-01', 'public_editable');
  const editableResp = await app.inject({
    method: 'PUT',
    url: '/api/pdfs/drawing-put-editable-01/pages/1/drawing',
    headers: OTHER_HEADERS,
    payload: { drawing_json: '{"strokes":["b"]}' },
  });
  assert.equal(editableResp.statusCode, 200);

  await app.close();
});

test('DELETE drawing rejects a non-owner request and allows the owner', async () => {
  seedDrawingPdf('drawing-delete-01', 'public');
  const app = await buildApp();
  await app.inject({
    method: 'PUT',
    url: '/api/pdfs/drawing-delete-01/pages/1/drawing',
    headers: OWNER_HEADERS,
    payload: { drawing_json: '{"strokes":["a"]}' },
  });

  const forbidden = await app.inject({
    method: 'DELETE',
    url: '/api/pdfs/drawing-delete-01/pages/1/drawing',
    headers: OTHER_HEADERS,
  });
  assert.equal(forbidden.statusCode, 403);
  const stillThere = db.prepare(`SELECT drawing_json FROM page_drawings WHERE pdf_id = ? AND page_number = 1`).get('drawing-delete-01');
  assert.notEqual(stillThere, undefined);

  const allowed = await app.inject({
    method: 'DELETE',
    url: '/api/pdfs/drawing-delete-01/pages/1/drawing',
    headers: OWNER_HEADERS,
  });
  assert.equal(allowed.statusCode, 204);
  const gone = db.prepare(`SELECT drawing_json FROM page_drawings WHERE pdf_id = ? AND page_number = 1`).get('drawing-delete-01');
  assert.equal(gone, undefined);

  await app.close();
});

test('PUT/DELETE drawing return 404 for an unknown presentation', async () => {
  const app = await buildApp();
  const putResp = await app.inject({
    method: 'PUT',
    url: '/api/pdfs/drawing-missing-01/pages/1/drawing',
    headers: OWNER_HEADERS,
    payload: { drawing_json: '{"strokes":[]}' },
  });
  assert.equal(putResp.statusCode, 404);

  const deleteResp = await app.inject({
    method: 'DELETE',
    url: '/api/pdfs/drawing-missing-01/pages/1/drawing',
    headers: OWNER_HEADERS,
  });
  assert.equal(deleteResp.statusCode, 404);

  await app.close();
});
