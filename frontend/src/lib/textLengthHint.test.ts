import test from 'node:test';
import assert from 'node:assert/strict';

import { getTextLengthHint } from './textLengthHint';

test('basic count below threshold is not nearLimit', () => {
  const h = getTextLengthHint(10, 2000);
  assert.equal(h.count, 10);
  assert.equal(h.max, 2000);
  assert.equal(h.remaining, 1990);
  assert.equal(h.nearLimit, false);
  assert.equal(h.label, '10/2000');
});

test('matches existing comment input behaviour (count > max-100 is nearLimit)', () => {
  // 留言輸入框原本的內聯邏輯為 `count > 1900` 即警示。
  assert.equal(getTextLengthHint(1900, 2000).nearLimit, false); // remaining 100，未達警示
  assert.equal(getTextLengthHint(1901, 2000).nearLimit, true);  // remaining 99，警示
});

test('at limit reports zero remaining and nearLimit', () => {
  const h = getTextLengthHint(2000, 2000);
  assert.equal(h.remaining, 0);
  assert.equal(h.nearLimit, true);
  assert.equal(h.label, '2000/2000');
});

test('count over max clamps remaining to 0 and stays nearLimit', () => {
  const h = getTextLengthHint(2050, 2000);
  assert.equal(h.remaining, 0);
  assert.equal(h.nearLimit, true);
});

test('custom warnWithin: remaining strictly below threshold warns', () => {
  assert.equal(getTextLengthHint(4501, 5000, 500).nearLimit, true);  // remaining 499 < 500
  assert.equal(getTextLengthHint(4500, 5000, 500).nearLimit, false); // remaining 500，未達
});

test('negative and non-finite inputs are sanitised', () => {
  const h = getTextLengthHint(-5, 2000);
  assert.equal(h.count, 0);
  assert.equal(h.remaining, 2000);
  const nan = getTextLengthHint(Number.NaN, Number.NaN);
  assert.equal(nan.count, 0);
  assert.equal(nan.max, 0);
  assert.equal(nan.remaining, 0);
  assert.equal(nan.label, '0/0');
});

test('fractional counts are floored', () => {
  const h = getTextLengthHint(10.9, 2000.9);
  assert.equal(h.count, 10);
  assert.equal(h.max, 2000);
});
