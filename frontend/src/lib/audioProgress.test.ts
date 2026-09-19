import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAudioProgress, filterAudioProgress } from './audioProgress';
import type { AudioProgressItem } from './api/pdfs';

const item = (over: Partial<AudioProgressItem> = {}): AudioProgressItem => ({
  page: 3,
  step: null,
  chars: 400,
  started_at: '2026-09-19T00:00:00.000Z',
  estimated_seconds: 40,
  segments_done: 0,
  segments_total: 1,
  ...over,
});
const at = (seconds: number) => Date.parse('2026-09-19T00:00:00.000Z') + seconds * 1000;

test('progress is elapsed time against the estimate', () => {
  const v = describeAudioProgress(item(), at(10));
  assert.equal(v.percent, 25);
  assert.equal(v.elapsedSeconds, 10);
  assert.equal(v.remainingSeconds, 30);
  assert.equal(v.overdue, false);
});

test('a running voice never shows as finished, even past its estimate', () => {
  const v = describeAudioProgress(item(), at(90));
  assert.equal(v.percent, 95);
  assert.equal(v.overdue, true);
  assert.equal(v.remainingSeconds, null);
});

test('finished segments put a floor under the percentage', () => {
  assert.equal(describeAudioProgress(item({ segments_done: 2, segments_total: 4 }), at(4)).percent, 50);
});

test('filtering: a page, one step, only the page audio, or the whole deck', () => {
  const items = [item(), item({ step: 0 }), item({ step: 1 }), item({ page: 4 })];
  assert.equal(filterAudioProgress(items).length, 4);
  assert.equal(filterAudioProgress(items, { page: 3 }).length, 3);
  assert.deepEqual(filterAudioProgress(items, { page: 3, step: 1 }).map((i) => i.step), [1]);
  assert.deepEqual(filterAudioProgress(items, { page: 3, step: null }).map((i) => i.step), [null]);
});
