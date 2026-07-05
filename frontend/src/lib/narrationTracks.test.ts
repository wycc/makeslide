import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cursorAtTime, strokesUntil } from './narrationTracks';

const track = [
  { tMs: 0, x: 0, y: 0 },
  { tMs: 1000, x: 1, y: 0 },
  { tMs: 2000, x: 1, y: 1 },
];

test('cursorAtTime interpolates between neighbouring points', () => {
  assert.deepEqual(cursorAtTime(track, 500), { x: 0.5, y: 0 });
  assert.deepEqual(cursorAtTime(track, 1500), { x: 1, y: 0.5 });
});

test('cursorAtTime returns the exact point at a sample time', () => {
  assert.deepEqual(cursorAtTime(track, 1000), { x: 1, y: 0 });
});

test('cursorAtTime clamps to the last point after the end, null before the start', () => {
  assert.deepEqual(cursorAtTime(track, 9999), { x: 1, y: 1 });
  assert.equal(cursorAtTime([{ tMs: 500, x: 0.2, y: 0.2 }], 100), null);
  assert.equal(cursorAtTime([], 100), null);
});

test('strokesUntil reveals only strokes that have started by the given time', () => {
  const strokes = [
    { tMs: 0, points: [{ x: 0, y: 0 }] },
    { tMs: 1000, points: [{ x: 1, y: 1 }] },
    { tMs: 3000, points: [{ x: 0.5, y: 0.5 }] },
  ];
  assert.equal(strokesUntil(strokes, 1500).length, 2);
  assert.equal(strokesUntil(strokes, 0).length, 1);
  assert.equal(strokesUntil(strokes, 5000).length, 3);
});
