import test from 'node:test';
import assert from 'node:assert/strict';

import { distSq, distPointToSegment, strokeHitsPoint } from './drawingGeometry';
import type { DrawingStroke } from './DrawingCanvas';

const stroke = (points: [number, number][]): DrawingStroke =>
  ({ color: '#fff', lineWidth: 2, points } as DrawingStroke);

test('distSq returns the squared euclidean distance', () => {
  assert.equal(distSq(0, 0, 3, 4), 25);
  assert.equal(distSq(1, 1, 1, 1), 0);
});

test('distPointToSegment measures distance to the nearest point on the segment', () => {
  // Perpendicular from above the middle of a horizontal segment.
  assert.equal(distPointToSegment(5, 3, 0, 0, 10, 0), 3);
  // Beyond an endpoint clamps to that endpoint.
  assert.equal(distPointToSegment(-4, 0, 0, 0, 10, 0), 4);
});

test('distPointToSegment treats a zero-length segment as a point', () => {
  assert.equal(distPointToSegment(3, 4, 0, 0, 0, 0), 5);
});

test('strokeHitsPoint detects a hit near a stroke vertex (normalized coords scaled by canvas)', () => {
  // vertex at (0.5,0.5) on a 100x100 canvas -> pixel (50,50); eraser at (52,50) r=5
  assert.equal(strokeHitsPoint(stroke([[0.5, 0.5]]), 52, 50, 5, 100, 100), true);
});

test('strokeHitsPoint detects a hit along the segment between two sparse points', () => {
  // segment from (0,0.5) to (1,0.5) on 100x100 -> y=50 line; eraser just above mid
  assert.equal(strokeHitsPoint(stroke([[0, 0.5], [1, 0.5]]), 50, 53, 5, 100, 100), true);
});

test('strokeHitsPoint returns false when the eraser is far from the stroke', () => {
  assert.equal(strokeHitsPoint(stroke([[0.1, 0.1], [0.2, 0.1]]), 90, 90, 5, 100, 100), false);
});
