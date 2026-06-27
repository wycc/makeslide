import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso() { return new Date().toISOString(); }

// Seed an ownerless ready PDF with `pageCount` pages, plus a poll, a comment and
// a drawing all on `contentPage`. Pages use stable uid paths.
function seed(id: string, pageCount: number, contentPage: number): void {
  const t = nowIso();
  for (const tb of ['page_polls', 'page_comments', 'page_drawings', 'pages']) {
    db.prepare(`DELETE FROM ${tb} WHERE pdf_id = ?`).run(id);
  }
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,require_script_confirmation,created_at,updated_at)
     VALUES (?,?,?,'ready',?,0,?,?)`,
  ).run(id, 't', 't.pdf', pageCount, t, t);
  const pagesDir = path.join(config.storageRoot, id, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (let i = 1; i <= pageCount; i++) {
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,status,created_at,updated_at)
       VALUES (?,?,?,?,'audio_ready',?,?)`,
    ).run(id, i, `u${i}`, `pages/u${i}.jpg`, t, t);
  }
  db.prepare(`INSERT INTO page_polls (pdf_id,page_number,question,options_json,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, contentPage, 'Q', '["a","b"]', t, t);
  db.prepare(`INSERT INTO page_comments (pdf_id,page_number,author,text,created_at) VALUES (?,?,?,?,?)`)
    .run(id, contentPage, 'me', 'hi', t);
  db.prepare(`INSERT INTO page_drawings (pdf_id,page_number,drawing_json,updated_at) VALUES (?,?,?,?)`)
    .run(id, contentPage, '{}', t);
}

function contentPages(id: string): { poll?: number; comment?: number; drawing?: number } {
  const get = (tb: string) =>
    (db.prepare(`SELECT page_number FROM ${tb} WHERE pdf_id = ?`).get(id) as { page_number: number } | undefined)?.page_number;
  return { poll: get('page_polls'), comment: get('page_comments'), drawing: get('page_drawings') };
}

function cleanup(id: string): void {
  for (const tb of ['page_polls', 'page_comments', 'page_drawings', 'pages']) {
    db.prepare(`DELETE FROM ${tb} WHERE pdf_id = ?`).run(id);
  }
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

// Regression: renumbering pages must realign per-page content (polls/comments/
// drawings) and must not throw FK errors (page_polls used to 500 on delete).
test('DELETE page realigns polls/comments/drawings on later pages', async () => {
  const id = `content-del-${Date.now()}`;
  seed(id, 4, 3); // content on page 3
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/pages/2` });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    // page 3 became page 2; its poll/comment/drawing must follow.
    assert.deepEqual(contentPages(id), { poll: 2, comment: 2, drawing: 2 });
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('DELETE removes the deleted page\'s comments and drawings (no reattach)', async () => {
  const id = `content-del2-${Date.now()}`;
  seed(id, 3, 2); // content on page 2, which we delete
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/pages/2` });
    assert.equal(res.statusCode, 200);
    // The deleted page's content is gone, not reattached to another page.
    assert.deepEqual(contentPages(id), { poll: undefined, comment: undefined, drawing: undefined });
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('INSERT page realigns polls/comments/drawings on later pages', async () => {
  const id = `content-ins-${Date.now()}`;
  seed(id, 3, 3); // content on page 3
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/pages`, payload: { after_page_number: 1 } });
    assert.equal(res.statusCode, 201, `expected 201 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    assert.deepEqual(contentPages(id), { poll: 4, comment: 4, drawing: 4 });
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('MOVE page realigns polls/comments/drawings with the moved page', async () => {
  const id = `content-move-${Date.now()}`;
  seed(id, 3, 3); // content on page 3
  const app = await buildApp();
  try {
    // move page 3 to position 1
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/pages/move`, payload: { from_page_number: 3, to_page_number: 1 } });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    // page 3's content follows it to page 1.
    assert.deepEqual(contentPages(id), { poll: 1, comment: 1, drawing: 1 });
  } finally {
    cleanup(id);
    await app.close();
  }
});
