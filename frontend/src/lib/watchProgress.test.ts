import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateWatchCompletion } from './watchProgress';

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
