// Shared pure helpers for the post-class report routes. These ratio/rounding
// formulas were previously inlined (and duplicated) across report.ts.

/**
 * `numerator / denominator`, guarded against non-positive denominators so an
 * empty population yields 0 instead of NaN/Infinity.
 */
export function safeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Round to 4 decimal places (CSV-friendly fixed precision). */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Poll divergence score: `1 - topOptionShare` where topOptionShare is the most
 * voted option's share of all votes. 0 = full consensus, closer to 1 = more
 * split. Returns 0 when there are no votes.
 */
export function pollDivergence(maxVotes: number, totalVotes: number): number {
  return totalVotes > 0 ? 1 - maxVotes / totalVotes : 0;
}

/** Arithmetic mean of the values, or null for an empty array. */
export function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Clamp to the [0, 1] range. */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Normalised per-page difficulty signals (each 0..1, or null when not applicable).
 * A page is "harder" when fewer viewers finish it, when its poll vote is more split,
 * and when it draws more questions/comments per viewer.
 */
export interface PageDifficultySignals {
  /** Completion rate (completed / viewers); lower means harder. null when no viewers. */
  completionRate: number | null;
  /** Poll divergence (0 consensus … 1 fully split); higher means harder. null when no votes. */
  pollDivergence: number | null;
  /** Questions/comments per viewer (capped at 1); higher means harder. null when no viewers. */
  questionRate: number | null;
}

/**
 * Combines the available difficulty signals into a single 0..1 score (higher = harder) by
 * averaging whichever signals are present (completion contributes its *in*completion, 1 - rate).
 * Returns null when no signal is available (e.g. a page nobody watched), so callers can render
 * an empty cell instead of a misleading 0. Pure function — easy to unit test in isolation.
 */
export function pageDifficultyScore(signals: PageDifficultySignals): number | null {
  const parts: number[] = [];
  if (signals.completionRate != null) parts.push(clamp01(1 - signals.completionRate));
  if (signals.pollDivergence != null) parts.push(clamp01(signals.pollDivergence));
  if (signals.questionRate != null) parts.push(clamp01(signals.questionRate));
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** Minimal per-question stat shape needed to rank quiz questions by difficulty. */
export interface QuestionDifficultyStat {
  question_id: string;
  question: string;
  attempt_count: number;
  wrong_count: number;
  correct_rate: number;
}

/** One entry in the "hardest questions" ranking returned by the report summary. */
export interface HardestQuestion {
  question_id: string;
  question: string;
  attempt_count: number;
  wrong_count: number;
  wrong_rate: number;
}

/**
 * Pick the `limit` hardest quiz questions for the post-class report summary.
 * Only attempted questions are considered; they are ranked by lowest correct
 * rate first, breaking ties by more wrong answers, and annotated with their
 * wrong rate (wrong / attempts, guarded against divide-by-zero). Pure function
 * extracted from the report summary route so the ranking can be unit-tested.
 */
export function selectHardestQuestions(
  stats: QuestionDifficultyStat[],
  limit = 5,
): HardestQuestion[] {
  return [...stats]
    .filter((s) => s.attempt_count > 0)
    .sort((a, b) => a.correct_rate - b.correct_rate || b.wrong_count - a.wrong_count)
    .slice(0, limit)
    .map((s) => ({
      question_id: s.question_id,
      question: s.question,
      attempt_count: s.attempt_count,
      wrong_count: s.wrong_count,
      wrong_rate: safeRatio(s.wrong_count, s.attempt_count),
    }));
}

/** One page's poll engagement, for ranking by how split its vote was. */
export interface PagePollStat {
  page_number: number;
  question: string | null;
  total_votes: number;
  divergence_score: number;
}

/**
 * Pick the `limit` most divergent (most "split") poll pages for the post-class report
 * summary. Only pages with at least one vote are considered; ranked by highest divergence
 * first, breaking ties by more total votes then lower page number. Pure function so the
 * ranking is unit-testable independent of the DB query that builds the input stats.
 */
export function selectMostDivergentPages(stats: PagePollStat[], limit = 5): PagePollStat[] {
  return [...stats]
    .filter((s) => s.total_votes > 0)
    .sort((a, b) => b.divergence_score - a.divergence_score || b.total_votes - a.total_votes || a.page_number - b.page_number)
    .slice(0, limit);
}

/** One page's combined difficulty score plus the signals that fed it, for display/ranking. */
export interface PageDifficultyStat {
  page_number: number;
  difficulty_score: number | null;
  completion_rate: number | null;
  poll_divergence_score: number | null;
  question_count: number;
}

/**
 * Pick the `limit` hardest pages (highest combined `pageDifficultyScore`) for the post-class
 * report summary. Pages with no computable score (no viewers at all) are excluded rather than
 * sorted to either end. Pure function, mirrors `selectHardestQuestions`/`selectMostDivergentPages`.
 */
export function selectHardestPages(stats: PageDifficultyStat[], limit = 5): PageDifficultyStat[] {
  return [...stats]
    .filter((s): s is PageDifficultyStat & { difficulty_score: number } => s.difficulty_score != null)
    .sort((a, b) => b.difficulty_score - a.difficulty_score || a.page_number - b.page_number)
    .slice(0, limit);
}
