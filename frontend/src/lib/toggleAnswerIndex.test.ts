import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleAnswerIndex } from './toggleAnswerIndex';

test('single-select returns only the chosen index regardless of current selection', () => {
  assert.deepEqual(toggleAnswerIndex([], 2, true), [2]);
  assert.deepEqual(toggleAnswerIndex([0, 1, 3], 2, true), [2]);
});

test('multi-select adds a new index and keeps ascending order', () => {
  assert.deepEqual(toggleAnswerIndex([2, 0], 1, false), [0, 1, 2]);
});

test('multi-select removes an already-selected index', () => {
  assert.deepEqual(toggleAnswerIndex([0, 1, 2], 1, false), [0, 2]);
});

test('multi-select adding to an empty selection yields a single-element array', () => {
  assert.deepEqual(toggleAnswerIndex([], 4, false), [4]);
});

test('multi-select removing the last selected index yields an empty array', () => {
  assert.deepEqual(toggleAnswerIndex([3], 3, false), []);
});

test('multi-select de-duplicates any repeated indices in the input', () => {
  // toggling an unrelated index should still return a de-duplicated, sorted set.
  assert.deepEqual(toggleAnswerIndex([1, 1, 2], 0, false), [0, 1, 2]);
});

test('does not mutate the input array', () => {
  const current = [0, 2];
  const result = toggleAnswerIndex(current, 1, false);
  assert.deepEqual(current, [0, 2]);
  assert.notEqual(result, current);
});
