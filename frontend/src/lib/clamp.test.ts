import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from './clamp';

test('clamp leaves values already inside the range unchanged', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(0, 0, 10), 0); // lower bound inclusive
  assert.equal(clamp(10, 0, 10), 10); // upper bound inclusive
});

test('clamp pulls out-of-range values to the nearest bound', () => {
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(42, 0, 10), 10);
  assert.equal(clamp(0.5, 0, 1), 0.5);
  assert.equal(clamp(2, 0, 1), 1);
});

test('clamp matches the inline Math.max/Math.min ordering it replaces', () => {
  const value = 3600;
  assert.equal(clamp(value, 0, 3600), Math.max(0, Math.min(3600, value)));
  assert.equal(clamp(-7, 0, 3600), Math.max(0, Math.min(3600, -7)));
});

test('clamp propagates NaN like the original inline expression', () => {
  assert.ok(Number.isNaN(clamp(NaN, 0, 10)));
});

test('clamp returns max when bounds are inverted (min > max)', () => {
  assert.equal(clamp(5, 10, 0), 0);
});
