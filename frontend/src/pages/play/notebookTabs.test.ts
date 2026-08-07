import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTEBOOK_TAB,
  NOTEBOOK_TABS,
  computeNotebookTabCounts,
  getAdjacentNotebookTab,
  getEdgeNotebookTab,
  isNotebookTab,
  normalizeNotebookTab,
  OPEN_CLASSROOM_INTERACT_EVENT,
} from './notebookTabs';

test('NOTEBOOK_TABS has four unique tabs with the default included', () => {
  const ids = NOTEBOOK_TABS.map((t) => t.id);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.includes(DEFAULT_NOTEBOOK_TAB));
});

test('isNotebookTab accepts known ids and rejects others', () => {
  assert.equal(isNotebookTab('slides'), true);
  assert.equal(isNotebookTab('ai'), true);
  assert.equal(isNotebookTab('nope'), false);
  assert.equal(isNotebookTab(undefined), false);
  assert.equal(isNotebookTab(null), false);
  assert.equal(isNotebookTab(3), false);
});

test('normalizeNotebookTab keeps valid values and falls back otherwise', () => {
  assert.equal(normalizeNotebookTab('interact'), 'interact');
  assert.equal(normalizeNotebookTab('bogus'), DEFAULT_NOTEBOOK_TAB);
  assert.equal(normalizeNotebookTab(null), DEFAULT_NOTEBOOK_TAB);
  assert.equal(normalizeNotebookTab('bogus', 'notes'), 'notes');
});

test('computeNotebookTabCounts sums interaction markers and reports slide count', () => {
  const counts = computeNotebookTabCounts({ slides: 12, bookmarks: 2, important: 3, polls: 1 });
  assert.equal(counts.slides, 12);
  assert.equal(counts.interact, 6);
  assert.equal(counts.ai, undefined);
  assert.equal(counts.notes, undefined);
});

test('computeNotebookTabCounts handles empty deck', () => {
  const counts = computeNotebookTabCounts({ slides: 0, bookmarks: 0, important: 0, polls: 0 });
  assert.equal(counts.slides, 0);
  assert.equal(counts.interact, 0);
});

test('computeNotebookTabCounts includes reviewItems in interact count', () => {
  const counts = computeNotebookTabCounts({ slides: 5, bookmarks: 1, important: 0, polls: 0, reviewItems: 4 });
  assert.equal(counts.interact, 5); // 1 bookmark + 4 review items
});

test('computeNotebookTabCounts defaults reviewItems to 0 when omitted', () => {
  const withoutReview = computeNotebookTabCounts({ slides: 3, bookmarks: 2, important: 1, polls: 1 });
  const withZeroReview = computeNotebookTabCounts({ slides: 3, bookmarks: 2, important: 1, polls: 1, reviewItems: 0 });
  assert.equal(withoutReview.interact, withZeroReview.interact);
});

test('getEdgeNotebookTab returns the first and last tabs', () => {
  assert.equal(getEdgeNotebookTab('first'), NOTEBOOK_TABS[0]!.id);
  assert.equal(getEdgeNotebookTab('last'), NOTEBOOK_TABS[NOTEBOOK_TABS.length - 1]!.id);
});

test('getAdjacentNotebookTab moves and wraps in both directions', () => {
  // Walk forward through every tab starting from the default (first) tab.
  let cur = DEFAULT_NOTEBOOK_TAB;
  const seen = [cur];
  for (let i = 0; i < NOTEBOOK_TABS.length - 1; i += 1) {
    cur = getAdjacentNotebookTab(cur, 1);
    seen.push(cur);
  }
  assert.equal(new Set(seen).size, NOTEBOOK_TABS.length); // visited all distinct tabs
  assert.equal(getAdjacentNotebookTab(cur, 1), DEFAULT_NOTEBOOK_TAB); // forward wraps to start
  assert.equal(getAdjacentNotebookTab(DEFAULT_NOTEBOOK_TAB, -1), cur); // backward wraps to last
});

test('OPEN_CLASSROOM_INTERACT_EVENT 指向存在的分頁', () => {
  // 這個事件的用途是把使用者送到有「結束投票」按鈕的那一頁；分頁 id 改名而事件沒跟著改的話，
  // 監聽端會安靜地切到一個不存在的分頁，症狀正好是原本回報的「找不到怎麼結束投票」。
  assert.ok(OPEN_CLASSROOM_INTERACT_EVENT.startsWith('makeslide:'));
  assert.ok(isNotebookTab('interact'), 'interact 分頁必須存在，否則這個事件切不過去');
});
