import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateWatchCompletion,
  calculateWatchProgressPercent,
  calculateAvgListenedPercent,
  formatWatchProgressBadgeCount,
} from './watchProgress';

test('evaluateWatchCompletion returns false when there is no audio (durationMs is null)', () => {
  const result = evaluateWatchCompletion({
    onEndedFired: true,
    listenedMs: 999999,
    tabHiddenMs: 0,
    durationMs: null,
  });
  assert.equal(result, false);
});

test('evaluateWatchCompletion returns true when onEnded fired and both ratios are within bounds', () => {
  const result = evaluateWatchCompletion({
    onEndedFired: true,
    listenedMs: 9000,
    tabHiddenMs: 500,
    durationMs: 10000,
  });
  assert.equal(result, true);
});

test('evaluateWatchCompletion returns false when listenedMs falls short of the 0.85 threshold', () => {
  const result = evaluateWatchCompletion({
    onEndedFired: true,
    listenedMs: 8000, // 0.8 of duration, below the 0.85 threshold
    tabHiddenMs: 0,
    durationMs: 10000,
  });
  assert.equal(result, false);
});

test('evaluateWatchCompletion returns false when tabHiddenMs exceeds the 0.15 threshold', () => {
  const result = evaluateWatchCompletion({
    onEndedFired: true,
    listenedMs: 9500,
    tabHiddenMs: 2000, // 0.2 of duration, above the 0.15 threshold
    durationMs: 10000,
  });
  assert.equal(result, false);
});

test('evaluateWatchCompletion returns false when onEnded never fired even if other ratios look complete', () => {
  const result = evaluateWatchCompletion({
    onEndedFired: false,
    listenedMs: 10000,
    tabHiddenMs: 0,
    durationMs: 10000,
  });
  assert.equal(result, false);
});

test('evaluateWatchCompletion treats the 0.85/0.15 thresholds as inclusive boundaries', () => {
  const atListenedBoundary = evaluateWatchCompletion({
    onEndedFired: true,
    listenedMs: 8500, // exactly 0.85
    tabHiddenMs: 1500, // exactly 0.15
    durationMs: 10000,
  });
  assert.equal(atListenedBoundary, true);
});

test('calculateWatchProgressPercent returns null when there are no viewers', () => {
  const result = calculateWatchProgressPercent({
    total_viewers: 0,
    completed_viewers: 0,
    avg_listened_ratio: null,
  });
  assert.equal(result, null);
});

test('calculateWatchProgressPercent rounds to the nearest integer percentage', () => {
  const result = calculateWatchProgressPercent({
    total_viewers: 3,
    completed_viewers: 1,
    avg_listened_ratio: 0.5,
  });
  // 1/3 = 33.33...% rounds to 33
  assert.equal(result, 33);
});

test('calculateWatchProgressPercent returns 100 when every viewer completed the page', () => {
  const result = calculateWatchProgressPercent({
    total_viewers: 4,
    completed_viewers: 4,
    avg_listened_ratio: 1,
  });
  assert.equal(result, 100);
});

test('calculateWatchProgressPercent clamps anomalous data to 100', () => {
  // completed_viewers > total_viewers（資料異常）不應顯示成 >100%
  const result = calculateWatchProgressPercent({
    total_viewers: 3,
    completed_viewers: 5,
    avg_listened_ratio: 1,
  });
  assert.equal(result, 100);
});

test('calculateAvgListenedPercent returns null for null ratio and rounds normal values', () => {
  assert.equal(calculateAvgListenedPercent(null), null);
  assert.equal(calculateAvgListenedPercent(0.5), 50);
  assert.equal(calculateAvgListenedPercent(0.333), 33);
});

test('calculateAvgListenedPercent clamps rewind ratios above 1 to 100', () => {
  // 使用者倒退重聽會使 ratio > 1，須夾在 100
  assert.equal(calculateAvgListenedPercent(1.3), 100);
});

test('formatWatchProgressBadgeCount returns null when there are no viewers', () => {
  const result = formatWatchProgressBadgeCount({
    total_viewers: 0,
    completed_viewers: 0,
    avg_listened_ratio: null,
  });
  assert.equal(result, null);
});

test('formatWatchProgressBadgeCount formats as "completed/total"', () => {
  const result = formatWatchProgressBadgeCount({
    total_viewers: 5,
    completed_viewers: 3,
    avg_listened_ratio: 0.72,
  });
  assert.equal(result, '3/5');
});
