import { isCorrectAnswer } from './quizCorrectness';

/**
 * Authoritative server-side quiz scoring, kept pure (no DB) so it can be unit
 * tested and guarded against drift from the frontend's lib/quizScoring.ts, which
 * computes the same preview scores. Total pool is 100 points.
 */
export const QUIZ_TOTAL_SCORE = 100;

/** Minimal shape needed for scoring (a subset of the full quiz question). */
export interface ScorableQuestion {
  type: 'single' | 'multiple';
  options: readonly unknown[];
  answer_indices: number[];
  score?: number | null;
}

/**
 * Per-question point values: questions with an explicit non-negative score keep
 * it; the rest split the remaining points of the 100-point pool evenly. Mirrors
 * the frontend normalizeQuestionScores().
 */
export function normalizeQuestionScores(questions: ScorableQuestion[]): number[] {
  if (questions.length === 0) return [];
  const explicit = questions.map((q) => (typeof q.score === 'number' && Number.isFinite(q.score) && q.score >= 0 ? q.score : null));
  const assigned = explicit.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const emptyIndices = explicit.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
  const remaining = Math.max(0, QUIZ_TOTAL_SCORE - assigned);
  const even = emptyIndices.length > 0 ? remaining / emptyIndices.length : 0;
  return explicit.map((v) => (v == null ? (emptyIndices.length > 0 ? even : 0) : v));
}

/**
 * Points earned for one question: single = all-or-nothing; multiple = per-option
 * partial credit where each option whose selected-state matches the answer key
 * earns an equal share. Mirrors the frontend calcQuestionScore().
 */
export function calcQuestionScore(question: ScorableQuestion, selected: number[], questionScore: number): number {
  if (question.type === 'single') {
    return isCorrectAnswer(question.answer_indices, selected) ? questionScore : 0;
  }
  const optionCount = question.options.length;
  if (optionCount <= 0) return 0;
  const perOption = questionScore / optionCount;
  const selectedSet = new Set(selected);
  let earned = 0;
  for (let idx = 0; idx < optionCount; idx += 1) {
    const shouldSelect = question.answer_indices.includes(idx);
    const didSelect = selectedSet.has(idx);
    if (shouldSelect === didSelect) earned += perOption;
  }
  return earned;
}
