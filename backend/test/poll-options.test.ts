import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePollOptions, sanitizePollOptions } from '../src/routes/pdfs/pollOptions';

test('parsePollOptions returns the string array for valid JSON', () => {
  assert.deepEqual(parsePollOptions('["A","B","C"]'), ['A', 'B', 'C']);
  assert.deepEqual(parsePollOptions('[]'), []);
});

test('parsePollOptions returns [] for malformed JSON instead of throwing', () => {
  assert.deepEqual(parsePollOptions('not json'), []);
  assert.deepEqual(parsePollOptions('["A",'), []);
});

test('parsePollOptions returns [] when the JSON is not an array', () => {
  assert.deepEqual(parsePollOptions('{"a":1}'), []);
  assert.deepEqual(parsePollOptions('"A"'), []);
  assert.deepEqual(parsePollOptions('null'), []);
  assert.deepEqual(parsePollOptions('42'), []);
});

test('parsePollOptions filters out non-string entries', () => {
  assert.deepEqual(parsePollOptions('["A",1,"B",null,true,"C"]'), ['A', 'B', 'C']);
});

test('parsePollOptions handles null/undefined input', () => {
  assert.deepEqual(parsePollOptions(null), []);
  assert.deepEqual(parsePollOptions(undefined), []);
});

test('sanitizePollOptions trims each option and drops blanks', () => {
  assert.deepEqual(sanitizePollOptions([' A ', '', '  ', 'B']), ['A', 'B']);
});

test('sanitizePollOptions caps to the given limit after cleaning', () => {
  assert.deepEqual(sanitizePollOptions(['a', 'b', '', 'c', 'd'], 2), ['a', 'b']);
});

test('sanitizePollOptions without a limit keeps all non-blank options', () => {
  assert.deepEqual(sanitizePollOptions(['a', 'b', 'c', 'd', 'e', 'f', 'g']), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
});

test('sanitizePollOptions returns [] for an all-blank or empty input', () => {
  assert.deepEqual(sanitizePollOptions([]), []);
  assert.deepEqual(sanitizePollOptions(['', '   ']), []);
});
