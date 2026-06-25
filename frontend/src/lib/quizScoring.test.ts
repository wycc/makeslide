import test from 'node:test';
import assert from 'node:assert/strict';

import type { QuizQuestion } from '../types';
import {
  QUIZ_TOTAL_SCORE,
  explicitScoreSum,
  scoreSumExceedingTotal,
} from './quizScoring';

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
