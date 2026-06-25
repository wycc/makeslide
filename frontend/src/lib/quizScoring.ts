import type { QuizQuestion } from '../types';

export const QUIZ_TOTAL_SCORE = 100;

// Match the backend's QUIZ_SCORE_SUM_EPSILON (backend/src/routes/pdfs/quizzes.ts)
// so the editor's overflow warning uses the same float tolerance as the
// server-side cap. Without it the editor compared `sum > 100` strictly and could
// block a quiz whose fractional scores sum to exactly 100 (e.g. 33.33 + 33.33 +
// 33.34 → 100.00000000000001 in floating point) even though the backend accepts it.
export const QUIZ_SCORE_SUM_EPSILON = 1e-6;

/**
 * Sum of only the explicitly-set per-question scores (mirrors backend
 * explicitScoreSum()). Questions left blank are treated as 0 here.
 */
export function explicitScoreSum(questions: QuizQuestion[]): number {
  return questions.reduce(
    (acc, q) => acc + (typeof q.score === 'number' && Number.isFinite(q.score) && q.score >= 0 ? q.score : 0),
    0,
  );
}

/**
 * The explicit-score sum when it exceeds the 100-point total beyond the float
 * tolerance the backend uses, otherwise null. Used to warn the teacher (and
 * block save) before the request reaches the server-side cap.
 */
export function scoreSumExceedingTotal(questions: QuizQuestion[]): number | null {
  const sum = explicitScoreSum(questions);
  return sum > QUIZ_TOTAL_SCORE + QUIZ_SCORE_SUM_EPSILON ? sum : null;
}
