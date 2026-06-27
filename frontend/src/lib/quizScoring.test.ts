import test from 'node:test';
import assert from 'node:assert/strict';

import type { QuizQuestion } from '../types';
import {
  QUIZ_TOTAL_SCORE,
  explicitScoreSum,
  scoreSumExceedingTotal,
  normalizeQuestionScores,
  isCorrectAnswer,
  calcQuestionScore,
  calcAttemptScore,
  maxAttemptScore,
  averageAttemptScore,
} from './quizScoring';

test('averageAttemptScore returns the mean of scored attempts', () => {
  assert.equal(averageAttemptScore([{ score: 80 }, { score: 100 }, { score: 60 }]), 80);
  assert.equal(averageAttemptScore([{ score: 50 }]), 50);
});

test('averageAttemptScore ignores unscored (null) attempts', () => {
  // only the two scored attempts count: mean(90, 70) = 80
  assert.equal(averageAttemptScore([{ score: 90 }, { score: null }, { score: 70 }]), 80);
});

test('averageAttemptScore returns null when no attempt is scored', () => {
  assert.equal(averageAttemptScore([]), null);
  assert.equal(averageAttemptScore([{ score: null }, { score: null }]), null);
});

test('averageAttemptScore returns the raw unrounded mean', () => {
  // mean(100, 0, 0) = 33.33… (rounding is the caller's responsibility)
  assert.ok(Math.abs(averageAttemptScore([{ score: 100 }, { score: 0 }, { score: 0 }])! - 100 / 3) < 1e-9);
});

function q(score: number | null): QuizQuestion {
  return {
    question: 'q',
    type: 'single',
    options: [{ text: 'a' }, { text: 'b' }],
    answer_indices: [0],
    score,
  } as unknown as QuizQuestion;
}

test('explicitScoreSum adds set scores and treats blank/invalid as 0', () => {
  assert.equal(explicitScoreSum([q(40), q(null), q(30)]), 70);
  assert.equal(explicitScoreSum([q(-5), q(20)]), 20); // negative ignored
  assert.equal(explicitScoreSum([]), 0);
});

test('scoreSumExceedingTotal returns null at or below the total', () => {
  assert.equal(scoreSumExceedingTotal([q(60), q(40)]), null); // exactly 100
  assert.equal(scoreSumExceedingTotal([q(50), q(40)]), null); // below 100
});

test('scoreSumExceedingTotal reports the sum when it genuinely exceeds the total', () => {
  assert.equal(scoreSumExceedingTotal([q(80), q(80)]), 160);
});

test('scoreSumExceedingTotal applies the same float tolerance as the backend', () => {
  // A sum a hair above 100 but within the backend's QUIZ_SCORE_SUM_EPSILON must
  // not be treated as an overflow, so the editor never blocks a quiz the server
  // would accept. Just past the tolerance, it is reported as exceeding.
  const withinTolerance = QUIZ_TOTAL_SCORE + 5e-7;
  const pastTolerance = QUIZ_TOTAL_SCORE + 1.5e-6;
  assert.equal(scoreSumExceedingTotal([q(withinTolerance)]), null);
  assert.equal(scoreSumExceedingTotal([q(pastTolerance)]), pastTolerance);
});

function mq(answer_indices: number[], optionCount: number, score: number | null = null): QuizQuestion {
  return {
    question: 'q',
    type: 'multiple',
    options: Array.from({ length: optionCount }, (_, i) => ({ text: `o${i}` })),
    answer_indices,
    score,
  } as unknown as QuizQuestion;
}

test('normalizeQuestionScores splits the remaining pool evenly among unscored questions', () => {
  assert.deepEqual(normalizeQuestionScores([q(null), q(null)]), [50, 50]);
  assert.deepEqual(normalizeQuestionScores([q(60), q(null)]), [60, 40]);
  assert.deepEqual(normalizeQuestionScores([q(40), q(40), q(40)]), [40, 40, 40]); // explicit kept even if > 100
  assert.deepEqual(normalizeQuestionScores([]), []);
});

test('isCorrectAnswer compares answer sets ignoring order and duplicates', () => {
  assert.equal(isCorrectAnswer(mq([0, 2], 3), [2, 0]), true);
  assert.equal(isCorrectAnswer(mq([0, 2], 3), [0, 2, 2]), true);
  assert.equal(isCorrectAnswer(mq([0, 2], 3), [0]), false);
  assert.equal(isCorrectAnswer(mq([0, 2], 3), [0, 1]), false);
});

test('calcQuestionScore: single question is all-or-nothing', () => {
  const single = { ...mq([1], 3), type: 'single' } as unknown as QuizQuestion;
  assert.equal(calcQuestionScore(single, [1], 10), 10);
  assert.equal(calcQuestionScore(single, [0], 10), 0);
});

test('calcQuestionScore: multiple question gives per-option partial credit', () => {
  const m = mq([0, 1], 4); // 4 options, correct = {0,1}
  // perfect: all 4 option-states match → full 12
  assert.equal(calcQuestionScore(m, [0, 1], 12), 12);
  // selecting only {0}: option0 matches(should+did), option1 mismatch, option2/3 match → 3/4 → 9
  assert.equal(calcQuestionScore(m, [0], 12), 9);
  // selecting nothing: options 2,3 match (should-not & did-not), 0,1 mismatch → 2/4 → 6
  assert.equal(calcQuestionScore(m, [], 12), 6);
  // zero options → 0
  assert.equal(calcQuestionScore(mq([], 0), [], 12), 0);
});

function qWithId(id: string, score: number | null): QuizQuestion {
  return { ...q(score), id } as unknown as QuizQuestion;
}

test('maxAttemptScore sums the normalized per-question scores', () => {
  assert.equal(maxAttemptScore([qWithId('a', null), qWithId('b', null)]), 100);
  assert.equal(maxAttemptScore([qWithId('a', 60), qWithId('b', null)]), 100);
  assert.equal(maxAttemptScore([]), 0);
});

test('calcAttemptScore sums earned points across questions by id', () => {
  const questions = [qWithId('a', null), qWithId('b', null)]; // single, answer [0], normalized 50/50
  // both correct → 100
  assert.equal(calcAttemptScore(questions, { a: [0], b: [0] }), 100);
  // one correct, one wrong → 50
  assert.equal(calcAttemptScore(questions, { a: [0], b: [1] }), 50);
  // missing answer treated as no selection (wrong for single) → 50
  assert.equal(calcAttemptScore(questions, { a: [0] }), 50);
  // no answers → 0
  assert.equal(calcAttemptScore(questions, {}), 0);
});

test('calcAttemptScore returns the raw (unrounded) total', () => {
  // three unscored questions → normalized 33.33…; all correct sums back to 100
  const questions = [qWithId('a', null), qWithId('b', null), qWithId('c', null)];
  assert.ok(Math.abs(calcAttemptScore(questions, { a: [0], b: [0], c: [0] }) - 100) < 1e-9);
  // a single correct one earns one third of 100 (unrounded)
  assert.ok(Math.abs(calcAttemptScore(questions, { a: [0] }) - 100 / 3) < 1e-9);
});
