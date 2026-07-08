import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { createPdfDir, pdfDir } from '../src/services/storage';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { loadExportedNotebooks } from '../src/routes/pdfs/export';

setSystemAuthSettings({ googleAuthEnabled: false });

function multipartZipUpload(boundary: string, filename: string, zipBuffer: Buffer): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, zipBuffer, tail]);
}

const SAMPLE_IPYNB = JSON.stringify({
  cells: [{ cell_type: 'code', source: 'print("hi")', metadata: {}, outputs: [], execution_count: null }],
  metadata: { kernelspec: { name: 'python3' } },
  nbformat: 4,
  nbformat_minor: 5,
});

// Seed a 2-page deck where page 1 is a normal image and page 2 is a notebook page
// (render_type='notebook' + notebook_path pointing at a real .ipynb on disk).
function seedDeckWithNotebook(id: string): { notebookRelPath: string } {
  const now = new Date().toISOString();
  const dir = createPdfDir(id);
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pages', 'imguid1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const notebookRelPath = 'pages/nbuid2.ipynb';
  fs.writeFileSync(path.join(dir, notebookRelPath), SAMPLE_IPYNB, 'utf8');

  fs.writeFileSync(
    path.join(dir, 'metadata.json'),
    JSON.stringify({
      id,
      title: 'Notebook Export Test',
      original_filename: 'nb.pdf',
      status: 'ready',
      page_count: 2,
      created_at: now,
      updated_at: now,
      pages: [
        { page_number: 1, image: 'pages/imguid1.png', text: null, status: 'audio_ready' },
        { page_number: 2, image: null, text: null, status: 'audio_ready', render_type: 'notebook', notebook_path: notebookRelPath },
      ],
    }),
    'utf8',
  );

  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, category, owner_sub, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 'Notebook Export Test', 'nb.pdf', 'ready', 2, 'general', null, 'public', now, now);
  db.prepare(
    `INSERT INTO pages (pdf_id, page_number, page_uid, image_path, status, render_type, animation_spec_path, notebook_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 1, 'imguid1', 'pages/imguid1.png', 'audio_ready', 'static-image', null, null, now, now);
  db.prepare(
    `INSERT INTO pages (pdf_id, page_number, page_uid, image_path, status, render_type, animation_spec_path, notebook_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 2, 'nbuid2', null, 'audio_ready', 'notebook', null, notebookRelPath, now, now);

  return { notebookRelPath };
}

test('loadExportedNotebooks returns only notebook pages', () => {
  const id = `nbexp${Date.now().toString(36)}`;
  try {
    seedDeckWithNotebook(id);
    const rows = loadExportedNotebooks(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.page_number, 2);
    assert.equal(rows[0]!.render_type, 'notebook');
    assert.equal(rows[0]!.notebook_path, 'pages/nbuid2.ipynb');
  } finally {
    db.prepare('DELETE FROM pages WHERE pdf_id = ?').run(id);
    db.prepare('DELETE FROM pdfs WHERE id = ?').run(id);
  }
});

test('export.zip -> import.zip round-trips a notebook page (render_type + .ipynb)', async () => {
  const app = await buildApp();
  const id = `nbrt${Date.now().toString(36)}`;
  let importedId: string | null = null;
  try {
    const { notebookRelPath } = seedDeckWithNotebook(id);

    const exportResp = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/export.zip` });
    assert.equal(exportResp.statusCode, 200);

    const boundary = '----nbboundary';
    const importResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/import.zip',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartZipUpload(boundary, 'export.zip', exportResp.rawPayload),
    });
    assert.equal(importResp.statusCode, 201);
    importedId = (importResp.json() as { id: string }).id;

    // render_type + notebook_path restored onto the imported page 2
    const page = db
      .prepare(`SELECT render_type, notebook_path FROM pages WHERE pdf_id = ? AND page_number = 2`)
      .get(importedId) as { render_type: string | null; notebook_path: string | null } | undefined;
    assert.ok(page, 'imported notebook page row should exist');
    assert.equal(page?.render_type, 'notebook');
    assert.equal(page?.notebook_path, notebookRelPath);

    // page 1 stays a normal image
    const page1 = db
      .prepare(`SELECT render_type FROM pages WHERE pdf_id = ? AND page_number = 1`)
      .get(importedId) as { render_type: string | null };
    assert.equal(page1.render_type, 'static-image');

    // the .ipynb file survived and the sidecar was consumed (not left in the deck dir)
    const importedDir = pdfDir(importedId);
    assert.equal(fs.existsSync(path.join(importedDir, notebookRelPath)), true, '.ipynb should survive the round-trip');
    assert.equal(fs.existsSync(path.join(importedDir, 'notebooks.json')), false, 'sidecar should be consumed on import');

    // the notebook endpoint serves the restored content
    const nbResp = await app.inject({ method: 'GET', url: `/api/pdfs/${importedId}/pages/2/notebook` });
    assert.equal(nbResp.statusCode, 200);
    const body = nbResp.json() as { render_type: string; notebook: { cells: Array<{ source: unknown }> } };
    assert.equal(body.render_type, 'notebook');
    assert.equal(body.notebook.cells.length, 1);
  } finally {
    if (importedId) {
      db.prepare('DELETE FROM pages WHERE pdf_id = ?').run(importedId);
      db.prepare('DELETE FROM pdfs WHERE id = ?').run(importedId);
    }
    db.prepare('DELETE FROM pages WHERE pdf_id = ?').run(id);
    db.prepare('DELETE FROM pdfs WHERE id = ?').run(id);
  }
});
