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

/**
 * Display state for an analysis-section header badge (quality / script / image).
 * Unifies the repeated "results not yet loaded → hide; loaded & clean → ✓;
 * loaded & has issues → count" decision shared by all three QualityCheckPanel
 * sections. `hasRun` is whether that analysis has produced a result, `running`
 * whether it is currently in flight, `issueCount` the number of flagged items.
 */
export type AnalysisBadge =
  | { kind: 'hidden' }
  | { kind: 'ok' }
  | { kind: 'issues'; count: number };

export function analysisBadgeState(
  hasRun: boolean,
  running: boolean,
  issueCount: number,
): AnalysisBadge {
  if (!hasRun || running) return { kind: 'hidden' };
  return issueCount === 0 ? { kind: 'ok' } : { kind: 'issues', count: issueCount };
}
