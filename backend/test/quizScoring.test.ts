import test from 'node:test';
import assert from 'node:assert/strict';

import { calcQuestionScore, normalizeQuestionScores, type ScorableQuestion } from '../src/services/quizScoring';

const single = (answer: number[]): ScorableQuestion => ({ type: 'single', options: [0, 0, 0, 0], answer_indices: answer });
const multiple = (answer: number[], optionCount = 4): ScorableQuestion =>
  ({ type: 'multiple', options: new Array(optionCount).fill(0), answer_indices: answer });

test('calcQuestionScore: single is all-or-nothing', () => {
  assert.equal(calcQuestionScore(single([1]), [1], 10), 10);
  assert.equal(calcQuestionScore(single([1]), [2], 10), 0);
  assert.equal(calcQuestionScore(single([1]), [], 10), 0);
});

test('calcQuestionScore: multiple awards per-option partial credit', () => {
  // 4 options, correct = {0,2}; perfect selection earns full marks.
  assert.equal(calcQuestionScore(multiple([0, 2]), [0, 2], 8), 8);
  // Selecting only one of two correct: options 0 (match), 1 (match-empty), 2 (wrong-missing), 3 (match-empty)
  // => 3 of 4 options correct-state → 3/4 * 8 = 6
  assert.equal(calcQuestionScore(multiple([0, 2]), [0], 8), 6);
  // Selecting nothing: options 1 and 3 match (not-selected, not-answer) → 2/4 * 8 = 4
  assert.equal(calcQuestionScore(multiple([0, 2]), [], 8), 4);
});

test('calcQuestionScore: multiple with no options earns 0', () => {
  assert.equal(calcQuestionScore(multiple([0], 0), [0], 8), 0);
});

test('normalizeQuestionScores: explicit scores kept, blanks split the remainder evenly', () => {
  const qs: ScorableQuestion[] = [
    { type: 'single', options: [0, 0], answer_indices: [0], score: 40 },
    { type: 'single', options: [0, 0], answer_indices: [0], score: null },
    { type: 'single', options: [0, 0], answer_indices: [0], score: null },
  ];
  // 40 explicit, 60 remaining split across the two blanks → 30 each.
  assert.deepEqual(normalizeQuestionScores(qs), [40, 30, 30]);
});

test('normalizeQuestionScores: all-explicit kept as-is; empty list → []', () => {
  const qs: ScorableQuestion[] = [
    { type: 'single', options: [0], answer_indices: [0], score: 70 },
    { type: 'single', options: [0], answer_indices: [0], score: 30 },
  ];
  assert.deepEqual(normalizeQuestionScores(qs), [70, 30]);
  assert.deepEqual(normalizeQuestionScores([]), []);
});
