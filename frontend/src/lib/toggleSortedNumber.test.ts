import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleSortedNumber } from './toggleSortedNumber';

test('adds a missing value and keeps ascending order', () => {
  assert.deepEqual(toggleSortedNumber([1, 3], 2), [1, 2, 3]);
  assert.deepEqual(toggleSortedNumber([5, 2], 9), [2, 5, 9]);
});

test('removes a value that is already present', () => {
  assert.deepEqual(toggleSortedNumber([1, 2, 3], 2), [1, 3]);
});

test('adding to an empty list yields a single-element list', () => {
  assert.deepEqual(toggleSortedNumber([], 4), [4]);
});

test('removing the only value yields an empty list', () => {
  assert.deepEqual(toggleSortedNumber([7], 7), []);
});

test('does not mutate the input list', () => {
  const list = [3, 1];
  toggleSortedNumber(list, 2);
  assert.deepEqual(list, [3, 1]);
});
