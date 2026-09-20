/**
 * Duplicating a deck must carry everything a page's content lives in.
 *
 * The page INSERT lists its columns by hand, so a column added later is simply absent from copies
 * — silently, because the copy looks complete until someone opens the one page that used it.
 * `elements_path` was missing: a page whose text had been added as an element layer lost the layer
 * in the copy and fell back to the baked composite, so the text appeared flattened into the
 * picture (and at the composite's size, which was its own bug).
 *
 * This test compares the live table against the duplicate's SQL, so the next column added has to
 * be either copied or written down here as deliberately dropped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db';

/** Columns a copy must NOT inherit, and why. */
const DELIBERATELY_DROPPED: Record<string, string> = {
  pdf_id: '新簡報的 id',
  created_at: '複製當下的時間',
  updated_at: '複製當下的時間',
  chat_history_json: '與原簡報那一頁的對話紀錄，不屬於新副本的內容',
};

const ROUTE = fs.readFileSync(fileURLToPath(new URL('../src/routes/pdfs/upload.ts', import.meta.url)), 'utf8');
const start = ROUTE.indexOf('const insertPage = db.prepare(');
const INSERT = ROUTE.slice(start, ROUTE.indexOf('VALUES', start));

test('every page column is copied, or written down as deliberately dropped', () => {
  assert.ok(start > 0, 'the duplicate still inserts pages column by column');
  const columns = (db.prepare('PRAGMA table_info(pages)').all() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(columns.includes('elements_path'), 'the element layer column exists');
  const missing = columns.filter((c) => !DELIBERATELY_DROPPED[c] && !new RegExp(`\\b${c}\\b`).test(INSERT));
  assert.deepEqual(missing, [], `複製簡報漏掉這些欄位（要嘛補進 INSERT，要嘛寫進 DELIBERATELY_DROPPED 並說明理由）`);
});

test('the regression itself: the element layer and the page\'s own words come along', () => {
  for (const column of ['elements_path', 'page_notes', 'page_prompt']) {
    assert.match(INSERT, new RegExp(`\\b${column}\\b`), `${column} 必須複製`);
  }
  // Read back too, or the insert binds undefined.
  const select = ROUTE.slice(ROUTE.indexOf('FROM pages WHERE pdf_id = ? ORDER BY page_number ASC', start - 4000) - 1200, start);
  for (const column of ['elements_path', 'page_notes', 'page_prompt']) {
    assert.match(select, new RegExp(`\\b${column}\\b`), `${column} 也要先讀出來`);
  }
});
