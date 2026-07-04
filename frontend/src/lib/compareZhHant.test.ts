import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareZhHant } from './compareZhHant';

test('orders strings and returns sign-consistent results', () => {
  assert.ok(compareZhHant('a', 'b') < 0);
  assert.ok(compareZhHant('b', 'a') > 0);
  assert.equal(compareZhHant('a', 'a'), 0);
});

test('numeric ordering (default) sorts embedded numbers naturally', () => {
  const sorted = ['項目10', '項目2', '項目1'].sort((a, b) => compareZhHant(a, b));
  assert.deepEqual(sorted, ['項目1', '項目2', '項目10']);
});

test('numeric:false falls back to lexical ordering of digits', () => {
  const sorted = ['項目10', '項目2', '項目1'].sort((a, b) => compareZhHant(a, b, { numeric: false }));
  assert.deepEqual(sorted, ['項目1', '項目10', '項目2']);
});

test("sensitivity 'base' treats case as equal", () => {
  assert.equal(compareZhHant('abc', 'ABC'), 0);
});

test('is usable directly as an Array.sort comparator', () => {
  assert.deepEqual(['banana', 'Apple', 'cherry'].sort(compareZhHant), ['Apple', 'banana', 'cherry']);
});
