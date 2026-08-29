import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db';
import { buildDeckOutline } from '../src/services/reactSlidePage';
import { buildReactSlideMessages, defaultSlideTheme } from '../src/services/reactSlide';
import { createPdfDir, pageScriptPath, removePdfDir } from '../src/services/storage';

/**
 * The outline is what stops a regenerated React page from being written as if it were the only
 * page in the deck; these tests pin the parts that matter for that: the deck's own framing, one
 * line per page, and an explicit marker for the page being generated.
 */

const PDF_ID = 'outline-test-deck';

function seedDeck(): void {
  createPdfDir(PDF_ID);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, description, user_prompt, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', 3, ?, ?, ?, ?)`,
  ).run(PDF_ID, '分散式系統入門', 'source.pdf', '給後端工程師的入門課', '請用生活化的比喻解釋', now, now);
  const scripts = ['今天要談分散式系統的三個難題。', '第一個難題是時間：沒有共用的時鐘。', '第二個難題是失敗偵測。'];
  scripts.forEach((script, index) => {
    const pageNumber = index + 1;
    const pageUid = `uid${pageNumber}`;
    fs.writeFileSync(pageScriptPath(PDF_ID, pageUid), script, 'utf8');
    db.prepare(
      `INSERT INTO pages (pdf_id, page_number, page_uid, script_path, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ready', ?, ?)`,
    ).run(PDF_ID, pageNumber, pageUid, path.posix.join('pages', `${pageUid}.script.txt`), now, now);
  });
}

function cleanupDeck(): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(PDF_ID);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(PDF_ID);
  void removePdfDir(PDF_ID);
}

test('buildDeckOutline lists every page and carries the deck framing', (t) => {
  seedDeck();
  t.after(cleanupDeck);

  const outline = buildDeckOutline(PDF_ID);
  assert.match(outline, /簡報標題：分散式系統入門/);
  assert.match(outline, /簡報說明：給後端工程師的入門課/);
  assert.match(outline, /簡報主旨：請用生活化的比喻解釋/);
  assert.match(outline, /第 1 頁：今天要談分散式系統的三個難題。/);
  assert.match(outline, /第 2 頁：第一個難題是時間/);
  assert.match(outline, /第 3 頁：第二個難題是失敗偵測。/);
});

test('buildDeckOutline marks the page being generated so the model does not merge the deck into it', (t) => {
  seedDeck();
  t.after(cleanupDeck);

  const outline = buildDeckOutline(PDF_ID, 2);
  assert.match(outline, /★ 第 2 頁：/);
  assert.match(outline, /★ 標記的是這次要產生的頁面/);
  // Only the current page is starred.
  assert.equal(outline.split('★ 第').length - 1, 1);
});

test('buildDeckOutline still returns the deck framing when pages have no transcript yet', (t) => {
  createPdfDir(PDF_ID);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', 1, ?, ?)`,
  ).run(PDF_ID, '空簡報', 'source.pdf', now, now);
  db.prepare(
    `INSERT INTO pages (pdf_id, page_number, page_uid, status, created_at, updated_at)
     VALUES (?, 1, 'uidx', 'pending', ?, ?)`,
  ).run(PDF_ID, now, now);
  t.after(cleanupDeck);

  const outline = buildDeckOutline(PDF_ID, 1);
  assert.match(outline, /簡報標題：空簡報/);
  assert.match(outline, /第 1 頁：（尚無內容）/);
});

test('buildReactSlideMessages passes the outline to the model alongside the page transcript', () => {
  const messages = buildReactSlideMessages({
    prompt: '重做這一頁',
    deckOutline: '簡報標題：分散式系統入門\n★ 第 2 頁：第一個難題是時間',
    pageScript: '第一個難題是時間：沒有共用的時鐘。',
    theme: defaultSlideTheme(),
  });
  const userContent = String(messages[1]?.content);
  assert.match(userContent, /這一頁在整份簡報中的位置/);
  assert.match(userContent, /★ 第 2 頁/);
  assert.match(userContent, /沒有共用的時鐘/);
});
