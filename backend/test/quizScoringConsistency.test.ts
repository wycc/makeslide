import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calcQuestionScore as backendCalc,
  normalizeQuestionScores as backendNormalize,
  type ScorableQuestion,
} from '../src/services/quizScoring';
import {
  calcQuestionScore as frontendCalc,
  normalizeQuestionScores as frontendNormalize,
} from '../../frontend/src/lib/quizScoring';
import type { QuizQuestion } from '../../frontend/src/types';

// The authoritative server-side scoring (services/quizScoring.ts) must match the
// frontend preview scoring (lib/quizScoring.ts); they are independent copies in
// two packages. These guards lock them together, mirroring the isCorrectAnswer
// consistency test.

const q = (over: Partial<ScorableQuestion>): ScorableQuestion =>
  ({ type: 'single', options: [0, 0, 0, 0], answer_indices: [0], ...over });

const CALC_CASES: Array<{ question: ScorableQuestion; selected: number[]; score: number }> = [
  { question: q({ type: 'single', answer_indices: [1] }), selected: [1], score: 10 },
  { question: q({ type: 'single', answer_indices: [1] }), selected: [2], score: 10 },
  { question: q({ type: 'multiple', answer_indices: [0, 2] }), selected: [0, 2], score: 8 },
  { question: q({ type: 'multiple', answer_indices: [0, 2] }), selected: [0], score: 8 },
  { question: q({ type: 'multiple', answer_indices: [0, 2] }), selected: [], score: 8 },
  { question: q({ type: 'multiple', answer_indices: [0, 2] }), selected: [0, 1, 2, 3], score: 8 },
];

test('backend and frontend calcQuestionScore agree on every case', () => {
  for (const { question, selected, score } of CALC_CASES) {
    assert.equal(
      backendCalc(question, selected, score),
      frontendCalc(question as unknown as QuizQuestion, selected, score),
      `disagreement for ${JSON.stringify(question)} selected=${JSON.stringify(selected)} score=${score}`,
    );
  }
});

const NORMALIZE_CASES: ScorableQuestion[][] = [
  [q({ score: 40 }), q({ score: null }), q({ score: null })],
  [q({ score: 70 }), q({ score: 30 })],
  [q({ score: null }), q({ score: null }), q({ score: null })],
  [],
];

test('backend and frontend normalizeQuestionScores agree on every case', () => {
  for (const questions of NORMALIZE_CASES) {
    assert.deepEqual(
      backendNormalize(questions),
      frontendNormalize(questions as unknown as QuizQuestion[]),
      `disagreement for ${JSON.stringify(questions)}`,
    );
  }
});
