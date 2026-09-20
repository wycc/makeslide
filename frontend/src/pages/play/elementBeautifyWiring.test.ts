import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Beautify is an edit the server makes to the page the *server* has. The wiring below is what
 * keeps the editor and the server talking about the same page, and what stops the button from
 * being offered where it cannot work.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the pending draft is saved before the server lays anything out', () => {
  const hook = read('./usePageElements.ts');
  const fn = hook.slice(hook.indexOf('const beautifyElements = useCallback('));
  const flushAt = fn.indexOf('await flushElementsSave();');
  const callAt = fn.indexOf('await beautifyPageElements(');
  assert.ok(flushAt > 0 && callAt > flushAt, '沒先存草稿，AI 排的就是舊版的元素');
  // The result is also an undo step in the editor, so Ctrl+Z after a beautify does what it says.
  assert.match(fn, /setUndoStack\(\(stack\) => \[\.\.\.stack\.slice\(-\(UNDO_LIMIT - 1\)\), elementsRef\.current\]\)/);
  assert.match(fn, /await reloadDetail\(\);/, '圖片換了，簡報資料要重新讀');
});

test('a half-failure is shown rather than swallowed', () => {
  const hook = read('./usePageElements.ts');
  assert.match(hook, /setBeautifyWarnings\(result\.warnings \?\? \[\]\)/);
  const tab = read('./PageElementsTab.tsx');
  assert.match(tab, /beautifyWarnings\.map\(/, '警告要顯示出來');
  assert.match(tab, /\{beautifyError \? /);
});

test('the button is not offered where it would fail', () => {
  const tab = read('./PageElementsTab.tsx');
  const button = tab.slice(tab.indexOf("t('play.elements.beautify')") - 400, tab.indexOf("t('play.elements.beautify')"));
  // No elements means nothing to lay out; the endpoint refuses, so the UI should too.
  assert.match(button, /pageElements\.length === 0/);
  assert.match(button, /disabled \|\| beautifyBusy/);
});

test('leaving the page forgets the last pass', () => {
  // The undo snapshot belongs to one page; showing "undo beautify" after a page change would undo
  // the wrong page's layout.
  const hook = read('./usePageElements.ts');
  const pageChange = hook.slice(hook.indexOf('draftPageRef.current = { pdfId, pageNumber };'));
  assert.match(pageChange.slice(0, 600), /setCanUndoBeautify\(false\);/);
});
