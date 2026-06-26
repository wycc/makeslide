import test from 'node:test';
import assert from 'node:assert/strict';
import { roundToTwoDecimals } from './roundTo';

test('roundToTwoDecimals leaves clean two-decimal values unchanged', () => {
  assert.equal(roundToTwoDecimals(0), 0);
  assert.equal(roundToTwoDecimals(12.34), 12.34);
  assert.equal(roundToTwoDecimals(100), 100);
});

test('roundToTwoDecimals rounds to the nearest cent', () => {
  assert.equal(roundToTwoDecimals(1.005), 1); // 1.005*100 === 100.49999… in float -> rounds down
  assert.equal(roundToTwoDecimals(2.345), 2.35);
  assert.equal(roundToTwoDecimals(2.344), 2.34);
  assert.equal(roundToTwoDecimals(-2.345), -2.35);
});

test('roundToTwoDecimals tidies floating-point accumulation error', () => {
  assert.equal(roundToTwoDecimals(33.33 + 33.33 + 33.34), 100); // 100.00000000000001 -> 100
  assert.equal(roundToTwoDecimals(0.1 + 0.2), 0.3); // 0.30000000000000004 -> 0.3
});

test('roundToTwoDecimals keeps more-precise costs at two decimals', () => {
  assert.equal(roundToTwoDecimals(0.123456), 0.12);
  assert.equal(roundToTwoDecimals(0.129), 0.13);
});
