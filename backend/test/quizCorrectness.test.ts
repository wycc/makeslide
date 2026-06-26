import test from 'node:test';
import assert from 'node:assert/strict';

import { isCorrectAnswer } from '../src/services/quizCorrectness';

test('isCorrectAnswer matches an exact single-answer selection', () => {
  assert.equal(isCorrectAnswer([2], [2]), true);
  assert.equal(isCorrectAnswer([2], [3]), false);
});

test('isCorrectAnswer ignores order and duplicates for multi-answer questions', () => {
  assert.equal(isCorrectAnswer([0, 2], [2, 0]), true);
  assert.equal(isCorrectAnswer([0, 2], [2, 0, 0, 2]), true);
  assert.equal(isCorrectAnswer([0, 2, 2], [0, 2]), true);
});

test('isCorrectAnswer is false when selection is a subset, superset, or differs', () => {
  assert.equal(isCorrectAnswer([0, 2], [0]), false); // subset
  assert.equal(isCorrectAnswer([0, 2], [0, 2, 3]), false); // superset
  assert.equal(isCorrectAnswer([0, 2], [1, 2]), false); // different
});

test('isCorrectAnswer treats empty-vs-empty as correct and empty-vs-nonempty as wrong', () => {
  assert.equal(isCorrectAnswer([], []), true);
  assert.equal(isCorrectAnswer([1], []), false);
  assert.equal(isCorrectAnswer([], [1]), false);
});
