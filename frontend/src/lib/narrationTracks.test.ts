import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cursorAtTime, strokesUntil, subtitleAtTime } from './narrationTracks';

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

test('subtitleAtTime shows only the recent words within the window', () => {
  const cues = [
    { tMs: 0, word: 'hello' },
    { tMs: 1000, word: 'there' },
    { tMs: 2000, word: 'friends' },
    { tMs: 9000, word: 'later' },
  ];
  assert.equal(subtitleAtTime(cues, 2500, 6000), 'hello there friends');
  // at 9500 with a 6s window, only "later" (>3500ms) remains; older words dropped
  assert.equal(subtitleAtTime(cues, 9500, 6000), 'later');
  assert.equal(subtitleAtTime(cues, -100, 6000), '');
  assert.equal(subtitleAtTime([], 1000), '');
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

test('strokesUntil grows a timed stroke point-by-point and interpolates the tip', () => {
  const strokes = [
    {
      tMs: 100,
      points: [
        { x: 0, y: 0, tMs: 100 },
        { x: 1, y: 0, tMs: 200 },
        { x: 1, y: 1, tMs: 300 },
      ],
    },
  ];
  // before the stroke starts → nothing
  assert.equal(strokesUntil(strokes, 50).length, 0);
  // only the first point is out yet
  assert.deepEqual(strokesUntil(strokes, 100)[0]!.points, [{ x: 0, y: 0, tMs: 100 }]);
  // halfway to the 2nd point → first point + interpolated tip at x=0.5
  const mid = strokesUntil(strokes, 150)[0]!.points;
  assert.equal(mid.length, 2);
  assert.deepEqual(mid[mid.length - 1], { x: 0.5, y: 0 });
  // past the end → all three points
  assert.equal(strokesUntil(strokes, 999)[0]!.points.length, 3);
});
