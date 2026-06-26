import test from 'node:test';
import assert from 'node:assert/strict';

import { isCorrectAnswer as backendIsCorrect } from '../src/services/quizCorrectness';
import { isCorrectAnswer as frontendIsCorrect } from '../../frontend/src/lib/quizScoring';
import type { QuizQuestion } from '../../frontend/src/types';

// isCorrectAnswer exists in two packages that must agree: the backend
// services/quizCorrectness.ts (quiz scoring + post-class report) and the
// frontend lib/quizScoring.ts (editor preview / quiz taking). The two are
// independent copies, so this guard locks their behaviour together — if one
// changes the "is this answer correct" semantics, this test fails.
//
// Signatures differ (frontend takes a QuizQuestion, backend takes the indices
// array), so we wrap the answer indices in a minimal question for the frontend.
const CASES: Array<{ answer: number[]; selected: number[] }> = [
  { answer: [2], selected: [2] },
  { answer: [2], selected: [3] },
  { answer: [0, 2], selected: [2, 0] },
  { answer: [0, 2], selected: [2, 0, 0, 2] },
  { answer: [0, 2, 2], selected: [0, 2] },
  { answer: [0, 2], selected: [0] },
  { answer: [0, 2], selected: [0, 2, 3] },
  { answer: [0, 2], selected: [1, 2] },
  { answer: [], selected: [] },
  { answer: [1], selected: [] },
  { answer: [], selected: [1] },
];

test('backend and frontend isCorrectAnswer agree on every case', () => {
  for (const { answer, selected } of CASES) {
    const question = { answer_indices: answer } as QuizQuestion;
    assert.equal(
      backendIsCorrect(answer, selected),
      frontendIsCorrect(question, selected),
      `disagreement for answer=${JSON.stringify(answer)} selected=${JSON.stringify(selected)}`,
    );
  }
});
