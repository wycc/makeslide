import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

// Page assets are served at /pages/<number>/image, thumbnail, audio … and the player versions those
// URLs with the page's updated_at. A page shifted onto a new number with its old updated_at gets a
// URL the browser may already hold for a different page — a deck where a React page was pushed
// through numbers 28, 29, 30 by repeated inserts later showed that page's picture on all three.
// So every renumbering must bump updated_at on the pages it moves.

setSystemAuthSettings({ googleAuthEnabled: false });

const OLD = '2020-01-01T00:00:00.000Z';

function cookie(): Record<string, string> {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub: 'renum-owner', email: 'renum-owner@example.com' }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return { cookie: `makeslide_session=${encodeURIComponent(`${payload}.${sig}`)}`, 'content-type': 'application/json' };
}

function seed(pdfId: string, pageCount: number): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,require_script_confirmation,created_at,updated_at)
     VALUES (?,?,?,'ready',?,'renum-owner','private',0,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, pageCount, OLD, OLD);
  const dir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= pageCount; i++) {
    const uid = `${pdfId}u${i}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'audio_ready',?,?)`,
    ).run(pdfId, i, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, OLD, OLD);
    fs.writeFileSync(path.join(dir, `${uid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
    fs.writeFileSync(path.join(dir, `${uid}.text.txt`), `text ${i}`, 'utf8');
    fs.writeFileSync(path.join(dir, `${uid}.script.txt`), `script ${i}`, 'utf8');
  }
}

const rows = (pdfId: string) =>
  db.prepare(`SELECT page_number, page_uid, updated_at FROM pages WHERE pdf_id = ? ORDER BY page_number`).all(pdfId) as Array<{ page_number: number; page_uid: string; updated_at: string }>;

test('inserting a page gives every page it shifts a new updated_at, and leaves the pages before it alone', async () => {
  const pdfId = 'renumIns01';
  seed(pdfId, 3);
  const app = await buildApp();
  const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages`, headers: cookie(), payload: { after_page_number: 1 } });
  assert.equal(resp.statusCode, 201, resp.body);
  const after = rows(pdfId);
  assert.deepEqual(after.map((r) => r.page_number), [1, 2, 3, 4]);
  assert.equal(after[0]?.updated_at, OLD, 'page 1 did not move');
  for (const r of after.slice(2)) {
    assert.ok(r.page_uid.startsWith(pdfId), 'an original page');
    assert.notEqual(r.updated_at, OLD, `page ${r.page_number} moved and needs a new asset version`);
  }
});
