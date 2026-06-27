import type { PageQualityResult } from './api';

/**
 * Pages that have at least one quality issue. Pure derivation of the
 * QualityCheckPanel's issue list from the raw per-page results (null-safe).
 */
export function selectIssuePages(results: PageQualityResult[] | null | undefined): PageQualityResult[] {
  return results?.filter((r) => r.issues.length > 0) ?? [];
}

/**
 * Page numbers eligible for the "batch fill empty scripts" action: pages flagged
 * with a missing or empty script, capped at `max` so a single click can't fan
 * out into an unbounded number of LLM rewrite calls. Pure and order-preserving.
 */
export function selectEmptyScriptFillPages(
  results: PageQualityResult[] | null | undefined,
  max: number,
): number[] {
  return selectIssuePages(results)
    .filter((p) => p.issues.some((it) => it.code === 'missing_script' || it.code === 'empty_script'))
    .map((p) => p.pageNumber)
    .slice(0, Math.max(0, max));
}
