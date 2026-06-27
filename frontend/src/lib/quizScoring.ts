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

/**
 * Per-question point values (mirrors backend normalizeQuestionScores()):
 * questions with an explicit score keep it; the rest split the remaining points
 * of the 100-point pool evenly.
 */
export function normalizeQuestionScores(questions: QuizQuestion[]): number[] {
  if (questions.length === 0) return [];
  const explicit = questions.map((q) => (typeof q.score === 'number' && Number.isFinite(q.score) && q.score >= 0 ? q.score : null));
  const assigned = explicit.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const emptyIndices = explicit.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
  const remaining = Math.max(0, QUIZ_TOTAL_SCORE - assigned);
  const even = emptyIndices.length > 0 ? remaining / emptyIndices.length : 0;
  return explicit.map((v) => (v == null ? (emptyIndices.length > 0 ? even : 0) : v));
}

/** True when the selected option set exactly equals the question's answer set. */
export function isCorrectAnswer(question: QuizQuestion, selected: number[]): boolean {
  const a = Array.from(new Set(question.answer_indices)).sort((x, y) => x - y);
  const b = Array.from(new Set(selected)).sort((x, y) => x - y);
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Points earned for a question (mirrors backend calcQuestionScore()):
 * single = all-or-nothing; multiple = per-option partial credit where each
 * option whose selected-state matches the answer key earns an equal share.
 */
export function calcQuestionScore(question: QuizQuestion, selected: number[], questionScore: number): number {
  if (question.type === 'single') {
    return isCorrectAnswer(question, selected) ? questionScore : 0;
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

/**
 * Total points earned for an attempt: sums calcQuestionScore() over all
 * questions, using normalizeQuestionScores() for the per-question point values.
 * `answersById` maps question id -> selected option indices (missing = no
 * answer). Returns the raw (unrounded) total; callers round for display.
 */
export function calcAttemptScore(
  questions: QuizQuestion[],
  answersById: Record<string, number[]>,
): number {
  const scoreTable = normalizeQuestionScores(questions);
  return questions.reduce(
    (acc, q, idx) => acc + calcQuestionScore(q, answersById[q.id] ?? [], scoreTable[idx] ?? 0),
    0,
  );
}

/** Maximum achievable points for a quiz (sum of normalized per-question scores). */
export function maxAttemptScore(questions: QuizQuestion[]): number {
  return normalizeQuestionScores(questions).reduce((acc, s) => acc + s, 0);
}

/**
 * Mean score across the attempts that actually have a score, ignoring attempts
 * whose score is null (not yet graded). Returns null when no attempt is scored,
 * so callers can show "—" instead of a misleading 0. The result is the raw mean;
 * round at the call site if needed.
 */
export function averageAttemptScore(attempts: ReadonlyArray<{ score: number | null }>): number | null {
  const scored = attempts.filter((a): a is { score: number } => a.score != null);
  if (scored.length === 0) return null;
  return scored.reduce((sum, a) => sum + a.score, 0) / scored.length;
}
