import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTags } from './parseTags';

test('splits a comma-separated string and trims each tag', () => {
  assert.deepEqual(parseTags('a, b ,c'), ['a', 'b', 'c']);
});

test('drops empty entries (leading/trailing commas, whitespace-only)', () => {
  assert.deepEqual(parseTags('a,,b, ,c,'), ['a', 'b', 'c']);
});

test('returns an empty array for null, undefined, or empty string', () => {
  assert.deepEqual(parseTags(null), []);
  assert.deepEqual(parseTags(undefined), []);
  assert.deepEqual(parseTags(''), []);
  assert.deepEqual(parseTags('   '), []);
});

test('handles a single tag', () => {
  assert.deepEqual(parseTags('solo'), ['solo']);
});
