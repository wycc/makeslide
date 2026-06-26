import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateWithEllipsis } from './truncate';

test('truncateWithEllipsis leaves text at or under the limit unchanged', () => {
  assert.equal(truncateWithEllipsis('', 5), '');
  assert.equal(truncateWithEllipsis('hi', 5), 'hi');
  assert.equal(truncateWithEllipsis('exact', 5), 'exact'); // length === maxLen, no ellipsis
});

test('truncateWithEllipsis cuts longer text and appends a single ellipsis', () => {
  assert.equal(truncateWithEllipsis('hello world', 5), 'hello…');
  assert.equal(truncateWithEllipsis('一二三四五六', 3), '一二三…');
});

test('truncateWithEllipsis treats maxLen 0 as truncate-everything for non-empty text', () => {
  assert.equal(truncateWithEllipsis('abc', 0), '…');
  assert.equal(truncateWithEllipsis('', 0), ''); // empty stays empty
});

test('truncateWithEllipsis returns text unchanged for non-finite or negative maxLen', () => {
  assert.equal(truncateWithEllipsis('hello', Number.NaN), 'hello');
  assert.equal(truncateWithEllipsis('hello', Number.POSITIVE_INFINITY), 'hello');
  assert.equal(truncateWithEllipsis('hello', -1), 'hello');
});

test('truncateWithEllipsis coerces non-string input to an empty string', () => {
  // @ts-expect-error 故意傳入非字串以驗證防呆
  assert.equal(truncateWithEllipsis(undefined, 5), '');
  // @ts-expect-error 故意傳入非字串以驗證防呆
  assert.equal(truncateWithEllipsis(null, 5), '');
});
