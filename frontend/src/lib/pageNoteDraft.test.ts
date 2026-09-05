import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePageNote, isPageNoteDirty, clampPageNote } from './pageNoteDraft';
import { MAX_PAGE_NOTE_LENGTH } from './noteLimits';

test('normalizePageNote 統一換行並去掉整份文件前後的空白', () => {
  assert.equal(normalizePageNote('  # 標題\r\n\r\n內文\r\n'), '# 標題\n\n內文');
  assert.equal(normalizePageNote('a\rb'), 'a\nb');
  assert.equal(normalizePageNote('   '), '');
});

test('normalizePageNote 保留 Markdown 的排版語意', () => {
  assert.equal(normalizePageNote('第一段\n\n第二段'), '第一段\n\n第二段');
  // 條列與縮排的前導空白要留著，否則巢狀清單會被拉平。
  assert.equal(normalizePageNote('- a\n  - b'), '- a\n  - b');
  // 行尾兩個空白是 Markdown 的硬換行，清掉等於改寫使用者的文件。
  assert.equal(normalizePageNote('一行  \n下一行'), '一行  \n下一行');
});

test('isPageNoteDirty 只看正規化後的差異', () => {
  assert.equal(isPageNoteDirty('內容', '內容'), false);
  assert.equal(isPageNoteDirty('內容\n', '內容'), false);
  assert.equal(isPageNoteDirty('內容\r\n', '內容'), false);
  assert.equal(isPageNoteDirty('內容', undefined), true);
  assert.equal(isPageNoteDirty('', null), false);
  assert.equal(isPageNoteDirty('新內容', '內容'), true);
});

test('clampPageNote 截到上限', () => {
  assert.equal(clampPageNote('abc', 5), 'abc');
  assert.equal(clampPageNote('abcdef', 5), 'abcde');
  assert.equal(clampPageNote('x'.repeat(MAX_PAGE_NOTE_LENGTH + 10)).length, MAX_PAGE_NOTE_LENGTH);
});
