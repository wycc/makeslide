import test from 'node:test';
import assert from 'node:assert/strict';

import { extractSnippet, SNIPPET_CONTEXT } from '../src/routes/pdfs/searchSnippet';

test('extractSnippet returns the full string with no ellipses when shorter than the window', () => {
  assert.equal(extractSnippet('the quick brown fox', 'brown'), 'the quick brown fox');
});

test('extractSnippet centers on the match with ellipses on both clipped sides', () => {
  const content = 'A'.repeat(100) + 'NEEDLE' + 'B'.repeat(100);
  const snippet = extractSnippet(content, 'needle');
  assert.ok(snippet.startsWith('...'), 'expected a leading ellipsis');
  assert.ok(snippet.endsWith('...'), 'expected a trailing ellipsis');
  assert.ok(snippet.includes('NEEDLE'), 'expected the matched text to be included');
  // SNIPPET_CONTEXT chars of A, the needle, SNIPPET_CONTEXT chars of B, plus two '...'
  assert.equal(snippet.length, SNIPPET_CONTEXT + 'NEEDLE'.length + SNIPPET_CONTEXT + 6);
});

test('extractSnippet adds no leading ellipsis when the match is at the very start', () => {
  const content = 'START' + 'C'.repeat(200);
  const snippet = extractSnippet(content, 'start');
  assert.ok(!snippet.startsWith('...'));
  assert.ok(snippet.endsWith('...'));
});

test('extractSnippet is case-insensitive but preserves the original casing', () => {
  assert.equal(extractSnippet('Hello WORLD here', 'world'), 'Hello WORLD here');
});

test('extractSnippet falls back to the start of the content when the keyword is absent', () => {
  const content = 'D'.repeat(200);
  const snippet = extractSnippet(content, 'missing');
  assert.equal(snippet, 'D'.repeat(SNIPPET_CONTEXT * 2));
  assert.ok(!snippet.includes('...'));
});
