import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizedPointerPosition } from './normalizedPointerPosition';

const rect = { left: 100, top: 50, width: 200, height: 100 };

test('returns the normalized position within the rect', () => {
  assert.deepEqual(normalizedPointerPosition(200, 100, rect), { x: 0.5, y: 0.5 });
});

test('maps the top-left corner to {0, 0}', () => {
  assert.deepEqual(normalizedPointerPosition(100, 50, rect), { x: 0, y: 0 });
});

test('maps the bottom-right corner to {1, 1}', () => {
  assert.deepEqual(normalizedPointerPosition(300, 150, rect), { x: 1, y: 1 });
});

test('clamps positions outside the rect to [0, 1]', () => {
  assert.deepEqual(normalizedPointerPosition(0, 0, rect), { x: 0, y: 0 });
  assert.deepEqual(normalizedPointerPosition(9999, 9999, rect), { x: 1, y: 1 });
});
