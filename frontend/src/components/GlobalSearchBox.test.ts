import test from 'node:test';
import assert from 'node:assert/strict';

import { highlightText } from './GlobalSearchBox';

test('highlightText returns the whole text unmatched for a blank query', () => {
  assert.deepEqual(highlightText('Hello world', ''), [{ text: 'Hello world', isMatch: false }]);
  assert.deepEqual(highlightText('Hello world', '   '), [{ text: 'Hello world', isMatch: false }]);
});

test('highlightText splits a single case-insensitive match into before/match/after', () => {
  assert.deepEqual(highlightText('Hello World', 'world'), [
    { text: 'Hello ', isMatch: false },
    { text: 'World', isMatch: true },
  ]);
});

test('highlightText marks every occurrence of the query', () => {
  assert.deepEqual(highlightText('aXaXa', 'a'), [
    { text: 'a', isMatch: true },
    { text: 'X', isMatch: false },
    { text: 'a', isMatch: true },
    { text: 'X', isMatch: false },
    { text: 'a', isMatch: true },
  ]);
});

test('highlightText preserves original casing in the matched slice and trims the query', () => {
  // Query is trimmed, so surrounding spaces do not widen the highlighted slice.
  assert.deepEqual(highlightText('the CAT sat', '  cat  '), [
    { text: 'the ', isMatch: false },
    { text: 'CAT', isMatch: true },
    { text: ' sat', isMatch: false },
  ]);
});

test('highlightText returns a single unmatched part when there is no match', () => {
  assert.deepEqual(highlightText('Hello world', 'xyz'), [{ text: 'Hello world', isMatch: false }]);
});
