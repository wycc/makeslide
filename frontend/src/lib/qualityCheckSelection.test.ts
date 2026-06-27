import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectIssuePages, selectEmptyScriptFillPages, analysisBadgeState } from './qualityCheckSelection';
import type { PageQualityResult } from './api';

const page = (pageNumber: number, codes: PageQualityResult['issues'][number]['code'][]): PageQualityResult => ({
  pageNumber,
  issues: codes.map((code) => ({ code })),
});

test('selectIssuePages keeps only pages with at least one issue', () => {
  const results: PageQualityResult[] = [
    page(1, []),
    page(2, ['missing_audio']),
    page(3, []),
    page(4, ['short_script', 'missing_image']),
  ];
  assert.deepEqual(selectIssuePages(results).map((p) => p.pageNumber), [2, 4]);
});

test('selectIssuePages is null-safe', () => {
  assert.deepEqual(selectIssuePages(null), []);
  assert.deepEqual(selectIssuePages(undefined), []);
  assert.deepEqual(selectIssuePages([]), []);
});

test('selectEmptyScriptFillPages picks only missing/empty-script pages, order preserved', () => {
  const results: PageQualityResult[] = [
    page(1, ['missing_audio']), // not a script gap
    page(2, ['missing_script']),
    page(3, ['short_script']), // short is not empty/missing
    page(4, ['empty_script', 'missing_image']),
  ];
  assert.deepEqual(selectEmptyScriptFillPages(results, 10), [2, 4]);
});

test('selectEmptyScriptFillPages caps the result at max', () => {
  const results: PageQualityResult[] = [1, 2, 3, 4, 5].map((n) => page(n, ['missing_script']));
  assert.deepEqual(selectEmptyScriptFillPages(results, 3), [1, 2, 3]);
  // a non-positive max yields an empty list (no fan-out)
  assert.deepEqual(selectEmptyScriptFillPages(results, 0), []);
});

test('selectEmptyScriptFillPages is null-safe', () => {
  assert.deepEqual(selectEmptyScriptFillPages(null, 5), []);
});

test('analysisBadgeState hides until the analysis has produced a result', () => {
  assert.deepEqual(analysisBadgeState(false, false, 0), { kind: 'hidden' });
  assert.deepEqual(analysisBadgeState(false, false, 3), { kind: 'hidden' });
});

test('analysisBadgeState hides while the analysis is in flight', () => {
  // running takes precedence even once a previous result exists
  assert.deepEqual(analysisBadgeState(true, true, 2), { kind: 'hidden' });
});

test('analysisBadgeState reports ok when a completed run found no issues', () => {
  assert.deepEqual(analysisBadgeState(true, false, 0), { kind: 'ok' });
});

test('analysisBadgeState reports the issue count when a completed run found issues', () => {
  assert.deepEqual(analysisBadgeState(true, false, 4), { kind: 'issues', count: 4 });
});
