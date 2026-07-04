import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCitedPages } from './extractCitedPages';

test('extractCitedPages extracts a single cited page number', () => {
  assert.deepEqual(extractCitedPages('這個概念如同（第 3 頁）所述。'), [3]);
});

test('extractCitedPages extracts multiple pages, sorted ascending and de-duplicated', () => {
  const text = '對照（第 5 頁）與（第 2 頁逐字稿），再回到（第 5 頁）的圖。';
  assert.deepEqual(extractCitedPages(text), [2, 5]);
});

test('extractCitedPages handles varied spacing including none', () => {
  assert.deepEqual(extractCitedPages('見第7頁，及第  12  頁。'), [7, 12]);
});

test('extractCitedPages ignores non-page mentions and the 原始來源 citation', () => {
  assert.deepEqual(extractCitedPages('根據（原始來源）的定義，沒有頁碼引用。'), []);
});

test('extractCitedPages ignores page zero and keeps only positive integers', () => {
  assert.deepEqual(extractCitedPages('第 0 頁不存在，但第 4 頁有。'), [4]);
});

test('extractCitedPages returns [] for empty or citation-free text', () => {
  assert.deepEqual(extractCitedPages(''), []);
  assert.deepEqual(extractCitedPages('這段回答完全沒有引用其他頁。'), []);
});

test('extractCitedPages is stable across repeated calls (no leaked regex lastIndex)', () => {
  const text = '參見（第 8 頁）。';
  assert.deepEqual(extractCitedPages(text), [8]);
  assert.deepEqual(extractCitedPages(text), [8]);
});
