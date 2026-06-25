import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, splitLines, toPages } from '../src/worker/steps/renderTextPages';

// Mirrors the module-private layout constants; these tests pin the current
// wrapping/pagination contract, so update them together if the source changes.
const CHARS_PER_LINE = 34;
const LINES_PER_PAGE = 12;

test('escapeXml escapes the five XML special characters', () => {
  assert.equal(escapeXml('<a> & "b" \'c\''), '&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;');
});

test('escapeXml escapes ampersands first so existing entities are not double-decoded', () => {
  // every & must become &amp;, including ones already part of "&lt;"
  assert.equal(escapeXml('&'), '&amp;');
  assert.equal(escapeXml('&lt;'), '&amp;lt;');
});

test('escapeXml leaves plain text untouched', () => {
  assert.equal(escapeXml('hello world 123'), 'hello world 123');
});

test('splitLines normalizes CRLF/CR and preserves blank lines', () => {
  assert.deepEqual(splitLines('a\r\nb\rc'), ['a', 'b', 'c']);
  assert.deepEqual(splitLines('a\n\nb'), ['a', '', 'b']);
});

test('splitLines returns [""] for empty input and trims trailing whitespace', () => {
  assert.deepEqual(splitLines(''), ['']);
  assert.deepEqual(splitLines('a   '), ['a']);
});

test('splitLines hard-wraps lines longer than CHARS_PER_LINE', () => {
  const long = 'x'.repeat(CHARS_PER_LINE + 6);
  const result = splitLines(long);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.length, CHARS_PER_LINE);
  assert.equal(result[1]!.length, 6);
  assert.equal(result.join(''), long);
});

test('toPages groups lines into pages of LINES_PER_PAGE', () => {
  const lines = Array.from({ length: LINES_PER_PAGE + 1 }, (_, i) => `L${i}`);
  const pages = toPages(lines);
  assert.equal(pages.length, 2);
  assert.equal(pages[0]!.split('\n').length, LINES_PER_PAGE);
  assert.equal(pages[1], `L${LINES_PER_PAGE}`);
});

test('toPages returns [""] for an empty list and a single page for a short list', () => {
  assert.deepEqual(toPages([]), ['']);
  assert.deepEqual(toPages(['a', 'b']), ['a\nb']);
});
