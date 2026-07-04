import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlideTimeline, type SlideSwitchEvent } from './slideTimeline';

const ev = (page: number, atMs: number): SlideSwitchEvent => ({ page, atMs });

test('buildSlideTimeline builds contiguous 0-based segments from switch events', () => {
  // recording started at t=1000, lasted 30000ms; switched to p1 at start, p2 at +10s, p3 at +25s.
  const segments = buildSlideTimeline(1000, [ev(1, 1000), ev(2, 11000), ev(3, 26000)], 30000);
  assert.deepEqual(segments, [
    { page: 1, startMs: 0, endMs: 10000 },
    { page: 2, startMs: 10000, endMs: 25000 },
    { page: 3, startMs: 25000, endMs: 30000 },
  ]);
});

test('buildSlideTimeline extends the first segment back to 0 when the first event is late', () => {
  const segments = buildSlideTimeline(0, [ev(5, 4000), ev(6, 9000)], 12000);
  assert.deepEqual(segments, [
    { page: 5, startMs: 0, endMs: 9000 },
    { page: 6, startMs: 9000, endMs: 12000 },
  ]);
});

test('buildSlideTimeline sorts out-of-order events', () => {
  const segments = buildSlideTimeline(0, [ev(3, 20000), ev(1, 0), ev(2, 10000)], 30000);
  assert.deepEqual(segments.map((s) => s.page), [1, 2, 3]);
});

test('buildSlideTimeline merges consecutive same-page switches', () => {
  const segments = buildSlideTimeline(0, [ev(1, 0), ev(1, 5000), ev(2, 10000)], 20000);
  assert.deepEqual(segments, [
    { page: 1, startMs: 0, endMs: 10000 },
    { page: 2, startMs: 10000, endMs: 20000 },
  ]);
});

test('buildSlideTimeline keeps a genuine return to a previous page', () => {
  const segments = buildSlideTimeline(0, [ev(1, 0), ev(2, 5000), ev(1, 10000)], 15000);
  assert.deepEqual(segments.map((s) => s.page), [1, 2, 1]);
});

test('buildSlideTimeline clamps events before the start and past the duration', () => {
  // p1 recorded 2s before start (negative → 0), p2 recorded past the end (clamped to duration).
  const segments = buildSlideTimeline(1000, [ev(1, -1000), ev(2, 999999)], 20000);
  assert.deepEqual(segments, [{ page: 1, startMs: 0, endMs: 20000 }]);
});

test('buildSlideTimeline drops zero-length segments; last switch at same instant wins', () => {
  // Two switches at the same moment (start): p1 then p2 → only p2 survives.
  const segments = buildSlideTimeline(0, [ev(1, 0), ev(2, 0)], 10000);
  assert.deepEqual(segments, [{ page: 2, startMs: 0, endMs: 10000 }]);
});

test('buildSlideTimeline returns [] for empty events or non-positive duration', () => {
  assert.deepEqual(buildSlideTimeline(0, [], 10000), []);
  assert.deepEqual(buildSlideTimeline(0, [ev(1, 0)], 0), []);
  assert.deepEqual(buildSlideTimeline(0, [ev(1, 0)], -5), []);
});

test('buildSlideTimeline ignores events with non-finite time or non-integer page', () => {
  const segments = buildSlideTimeline(0, [ev(1, 0), ev(1.5, 3000), ev(2, Number.NaN)], 10000);
  assert.deepEqual(segments, [{ page: 1, startMs: 0, endMs: 10000 }]);
});
