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
