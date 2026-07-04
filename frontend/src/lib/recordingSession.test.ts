import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRecording, recordSlideSwitch, stopRecording } from './recordingSession';

test('startRecording seeds the session with the starting page as the first event', () => {
  const s = startRecording(1, 1000);
  assert.equal(s.startedAtMs, 1000);
  assert.deepEqual(s.events, [{ page: 1, atMs: 1000 }]);
});

test('recordSlideSwitch appends an event when the page changes', () => {
  let s = startRecording(1, 1000);
  s = recordSlideSwitch(s, 2, 1500);
  assert.deepEqual(s.events, [{ page: 1, atMs: 1000 }, { page: 2, atMs: 1500 }]);
});

test('recordSlideSwitch is a no-op (same reference) when the page is unchanged', () => {
  const s = startRecording(1, 1000);
  const s2 = recordSlideSwitch(s, 1, 1200);
  assert.equal(s2, s);
});

test('recordSlideSwitch does not mutate the previous session', () => {
  const s = startRecording(1, 1000);
  recordSlideSwitch(s, 2, 1500);
  assert.deepEqual(s.events, [{ page: 1, atMs: 1000 }]);
});

test('stopRecording produces a normalized timeline relative to the start', () => {
  let s = startRecording(1, 1000);
  s = recordSlideSwitch(s, 2, 11000); // +10s
  s = recordSlideSwitch(s, 3, 26000); // +25s
  const timeline = stopRecording(s, 31000); // duration 30s
  assert.deepEqual(timeline, [
    { page: 1, startMs: 0, endMs: 10000 },
    { page: 2, startMs: 10000, endMs: 25000 },
    { page: 3, startMs: 25000, endMs: 30000 },
  ]);
});

test('stopRecording with no switches yields a single full-length segment', () => {
  const s = startRecording(4, 5000);
  assert.deepEqual(stopRecording(s, 15000), [{ page: 4, startMs: 0, endMs: 10000 }]);
});

test('stopRecording clamps a stop time at/before the start to an empty timeline', () => {
  const s = startRecording(1, 1000);
  assert.deepEqual(stopRecording(s, 1000), []);
});
