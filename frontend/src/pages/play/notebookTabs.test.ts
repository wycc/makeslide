import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTEBOOK_TAB,
  NOTEBOOK_TABS,
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
