import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';

const PDF_ID = 'test-pages-api-01';

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
