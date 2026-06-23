import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffleArray } from './utils';

test('shuffleArray returns the same array reference', () => {
  const arr = [1, 2, 3];
  assert.equal(shuffleArray(arr), arr);
});

test('shuffleArray preserves all elements', () => {
  const original = [1, 2, 3, 4, 5];
  const shuffled = shuffleArray([...original]);
  assert.deepEqual(shuffled.sort((a, b) => a - b), original);
});

test('shuffleArray handles empty array', () => {
  assert.deepEqual(shuffleArray([]), []);
});

test('shuffleArray handles single element', () => {
  assert.deepEqual(shuffleArray(['only']), ['only']);
});

test('shuffleArray produces at least one ordering different from the original over many runs', () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8];
  let sawDifferent = false;
  for (let i = 0; i < 50; i++) {
    const result = shuffleArray([...original]);
    if (result.some((v, idx) => v !== original[idx])) {
      sawDifferent = true;
      break;
    }
  }
  assert.ok(sawDifferent);
});
