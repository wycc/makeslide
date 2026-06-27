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
