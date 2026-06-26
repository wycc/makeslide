import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMmSs } from './formatMmSs';

test('formatMmSs renders zero and pads to two digits', () => {
  assert.equal(formatMmSs(0), '00:00');
  assert.equal(formatMmSs(5), '00:05');
});

test('formatMmSs splits minutes and seconds', () => {
  assert.equal(formatMmSs(60), '01:00');
  assert.equal(formatMmSs(90), '01:30');
  assert.equal(formatMmSs(125), '02:05');
});

test('formatMmSs keeps minutes beyond 60 as mm:ss', () => {
  assert.equal(formatMmSs(3661), '61:01');
});

test('formatMmSs floors fractional seconds', () => {
  assert.equal(formatMmSs(90.9), '01:30');
});

test('formatMmSs treats negative or NaN as zero', () => {
  assert.equal(formatMmSs(-5), '00:00');
  assert.equal(formatMmSs(Number.NaN), '00:00');
});
