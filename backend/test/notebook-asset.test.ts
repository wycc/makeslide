import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import {
  MAX_NOTEBOOK_CELLS,
  defaultNotebook,
  validateNotebook,
} from '../src/services/notebookAsset';

const PDF_ID = 'test-notebook-asset-01';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
const AUTH_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}` };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

const SHARE_TOKEN = 'nbshare000001'; // must satisfy the 12–128 char share-token regex

function seedNotebookPdf(pdfId: string, pageCount: number): void {
  const t = nowIso();
  // Remove any stored assets (e.g. .ipynb from a prior run) so each test starts clean.
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', pageCount, t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (let i = 1; i <= pageCount; i++) {
    const uid = `nbuid${i}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, i, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${uid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
  }

  // Seed a metadata.json so the PUT metadata sync has something to update.
  const meta = {
    id: pdfId,
    title: 't',
    original_filename: 't.pdf',
    status: 'ready',
    progress_step: null,
    progress_current: null,
    progress_total: null,
    page_count: pageCount,
    error_message: null,
    owner_sub: 'account-1',
    visibility: 'private',
    created_at: t,
    updated_at: t,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      page_number: i + 1,
      image: `pages/nbuid${i + 1}.jpg`,
      text: `pages/nbuid${i + 1}.text.txt`,
      status: 'audio_ready',
    })),
  };
  fs.writeFileSync(path.join(config.storageRoot, pdfId, 'metadata.json'), JSON.stringify(meta, null, 2), 'utf8');
}

function seedShareToken(pdfId: string, token: string, access: 'read_only' | 'editable' = 'read_only'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ? AND token = ?`).run(pdfId, token);
  db.prepare(`INSERT INTO pdf_shares (pdf_id, token, access, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(pdfId, token, access, t, t);
}

function sampleNotebook(): Record<string, unknown> {
  return {
    cells: [
      { cell_type: 'markdown', source: ['# Title\n', 'Intro'], metadata: {} },
      {
        cell_type: 'code',
        source: 'print(1 + 1)',
        metadata: {},
        execution_count: 3,
        outputs: [{ output_type: 'stream', name: 'stdout', text: ['2\n'] }],
      },
    ],
    metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' } },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

// ---- pure validation ----

test('validateNotebook accepts a valid nbformat doc and preserves outputs/execution_count', () => {
  const result = validateNotebook(sampleNotebook());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.notebook.cells.length, 2);
    const code = result.notebook.cells[1] as Record<string, unknown>;
    assert.equal(code.execution_count, 3);
    assert.deepEqual(code.outputs, [{ output_type: 'stream', name: 'stdout', text: ['2\n'] }]);
    // passthrough preserves kernelspec metadata
    assert.deepEqual((result.notebook.metadata as Record<string, unknown>).kernelspec, {
      name: 'python3',
      display_name: 'Python 3',
    });
  }
});

test('validateNotebook fills required top-level defaults', () => {
  const result = validateNotebook({ cells: [] });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.notebook.nbformat, 4);
    assert.equal(result.notebook.nbformat_minor, 5);
    assert.deepEqual(result.notebook.metadata, {});
  }
});

test('validateNotebook rejects non-object, bad cell_type, and too many cells', () => {
  assert.equal(validateNotebook(null).ok, false);
  assert.equal(validateNotebook('nb').ok, false);
  assert.equal(validateNotebook([]).ok, false);
  assert.equal(validateNotebook({ cells: [{ cell_type: 'sql', source: '' }] }).ok, false);
  assert.equal(validateNotebook({ cells: [{ cell_type: 'code' }] }).ok, false); // missing source
  const tooMany = { cells: Array.from({ length: MAX_NOTEBOOK_CELLS + 1 }, () => ({ cell_type: 'code', source: '' })) };
  assert.equal(validateNotebook(tooMany).ok, false);
});

test('defaultNotebook is itself valid', () => {
  assert.equal(validateNotebook(defaultNotebook()).ok, true);
});

// ---- route CRUD ----

test('GET notebook returns a default empty notebook when none is stored', async () => {
  seedNotebookPdf(PDF_ID, 2);
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/pages/1/notebook`, headers: AUTH_HEADERS });
    assert.equal(resp.statusCode, 200);
    assert.equal(resp.headers['cache-control'], 'no-store');
    const body = resp.json() as { page_number: number; render_type: string; notebook: { cells: unknown[] } };
    assert.equal(body.page_number, 1);
    assert.equal(body.render_type, 'static-image');
    assert.equal(body.notebook.cells.length, 1);
  } finally {
    await app.close();
  }
});

test('PUT notebook writes .ipynb, flips render_type, syncs DB + metadata, and round-trips losslessly', async () => {
  seedNotebookPdf(PDF_ID, 2);
  const app = await buildApp();
  try {
    const putResp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${PDF_ID}/pages/1/notebook`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { notebook: sampleNotebook() },
    });
    assert.equal(putResp.statusCode, 200);
    const putBody = putResp.json() as { render_type: string; notebook_url: string };
    assert.equal(putBody.render_type, 'notebook');
    assert.equal(putBody.notebook_url, `api/pdfs/${PDF_ID}/pages/1/notebook`);

    // file on disk
    const nbFile = path.join(config.storageRoot, PDF_ID, 'pages', 'nbuid1.ipynb');
    assert.equal(fs.existsSync(nbFile), true);

    // DB row updated
    const row = db
      .prepare(`SELECT render_type, notebook_path FROM pages WHERE pdf_id = ? AND page_number = 1`)
      .get(PDF_ID) as { render_type: string; notebook_path: string };
    assert.equal(row.render_type, 'notebook');
    assert.equal(row.notebook_path, 'pages/nbuid1.ipynb');

    // metadata.json synced
    const meta = JSON.parse(fs.readFileSync(path.join(config.storageRoot, PDF_ID, 'metadata.json'), 'utf8')) as {
      pages: Array<{ page_number: number; render_type?: string; notebook_path?: string }>;
    };
    const metaPage = meta.pages.find((p) => p.page_number === 1);
    assert.equal(metaPage?.render_type, 'notebook');
    assert.equal(metaPage?.notebook_path, 'pages/nbuid1.ipynb');

    // GET round-trips the stored notebook, preserving outputs
    const getResp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}/pages/1/notebook`, headers: AUTH_HEADERS });
    assert.equal(getResp.statusCode, 200);
    const got = getResp.json() as { render_type: string; notebook: { cells: Array<Record<string, unknown>> } };
    assert.equal(got.render_type, 'notebook');
    assert.equal(got.notebook.cells.length, 2);
    assert.equal(got.notebook.cells[1].execution_count, 3);
    assert.deepEqual(got.notebook.cells[1].outputs, [{ output_type: 'stream', name: 'stdout', text: ['2\n'] }]);

    // detail API exposes notebook_url + render_type
    const detailResp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}`, headers: AUTH_HEADERS });
    assert.equal(detailResp.statusCode, 200);
    const detail = detailResp.json() as { pages: Array<{ page_number: number; render_type: string; notebook_url: string | null }> };
    assert.equal(detail.pages[0].render_type, 'notebook');
    assert.equal(detail.pages[0].notebook_url, `api/pdfs/${PDF_ID}/pages/1/notebook`);
    assert.equal(detail.pages[1].render_type, 'static-image');
    assert.equal(detail.pages[1].notebook_url, null);
  } finally {
    await app.close();
  }
});

test('PUT notebook rejects an invalid document with 400', async () => {
  seedNotebookPdf(PDF_ID, 1);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${PDF_ID}/pages/1/notebook`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { notebook: { cells: [{ cell_type: 'nope', source: '' }] } },
    });
    assert.equal(resp.statusCode, 400);
    const body = resp.json() as { error: { code: string } };
    assert.equal(body.error.code, 'INVALID_NOTEBOOK');
  } finally {
    await app.close();
  }
});

test('notebook endpoints enforce account isolation (private): non-owner 403, owner ok, share token reads', async () => {
  seedNotebookPdf(PDF_ID, 1);
  seedShareToken(PDF_ID, SHARE_TOKEN, 'read_only');
  const app = await buildApp();
  try {
    const url = `/api/pdfs/${PDF_ID}/pages/1/notebook`;
    // non-owner read on a private deck → 403
    const forbiddenGet = await app.inject({ method: 'GET', url, headers: OTHER_HEADERS });
    assert.equal(forbiddenGet.statusCode, 403);
    // non-owner write → 403
    const forbiddenPut = await app.inject({
      method: 'PUT',
      url,
      headers: { ...OTHER_HEADERS, 'content-type': 'application/json' },
      payload: { notebook: sampleNotebook() },
    });
    assert.equal(forbiddenPut.statusCode, 403);
    // owner read → 200
    assert.equal((await app.inject({ method: 'GET', url, headers: AUTH_HEADERS })).statusCode, 200);
    // read-only share token read → 200, but write → 403
    assert.equal((await app.inject({ method: 'GET', url: `${url}?share=${SHARE_TOKEN}` })).statusCode, 200);
    const sharedPut = await app.inject({
      method: 'PUT',
      url: `${url}?share=${SHARE_TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload: { notebook: sampleNotebook() },
    });
    assert.equal(sharedPut.statusCode, 403);
  } finally {
    await app.close();
  }
});
