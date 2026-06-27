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

// Seed an ownerless (publicly editable) ready PDF with `pageCount` pages and one
// poll on `pollPage`. Pages use stable uid paths matching production.
function seed(id: string, pageCount: number, pollPage: number): void {
  const t = nowIso();
  db.prepare(`DELETE FROM page_polls WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
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
  db.prepare(
    `INSERT INTO page_polls (pdf_id,page_number,question,options_json,created_at,updated_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(id, pollPage, 'Q', '["a","b"]', t, t);
}

function pollPage(id: string): number | undefined {
  const row = db.prepare(`SELECT page_number FROM page_polls WHERE pdf_id = ?`).get(id) as { page_number: number } | undefined;
  return row?.page_number;
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM page_polls WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

// Regression: deleting a page used to throw a FOREIGN KEY error (500) when a
// later page had a poll, and left polls misaligned, because page renumbering did
// not move the child page_polls rows. The delete path now defers FK checks and
// shifts child rows in lockstep.
test('DELETE page realigns polls on later pages (no FK error)', async () => {
  const id = `poll-del-${Date.now()}`;
  seed(id, 4, 3); // poll on page 3
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/pages/2` });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    // page 3 became page 2; its poll must follow.
    assert.equal(pollPage(id), 2);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('INSERT page realigns polls on later pages (no FK error)', async () => {
  const id = `poll-ins-${Date.now()}`;
  seed(id, 3, 3); // poll on page 3
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/pages`, payload: { after_page_number: 1 } });
    assert.equal(res.statusCode, 201, `expected 201 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    // page 3 shifted to page 4; its poll must follow.
    assert.equal(pollPage(id), 4);
  } finally {
    cleanup(id);
    await app.close();
  }
});
