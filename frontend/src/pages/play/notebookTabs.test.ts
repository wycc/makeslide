import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTEBOOK_TAB,
  NOTEBOOK_TABS,
  computeNotebookTabCounts,
  getAdjacentNotebookTab,
  isNotebookTab,
  normalizeNotebookTab,
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
