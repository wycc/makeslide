import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, splitLines, toPages } from '../src/worker/steps/renderTextPages';

// ── escapeXml ──────────────────────────────────────────────────────────────

test('escapeXml escapes all five reserved XML characters', () => {
  assert.equal(escapeXml('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
});

test('escapeXml escapes repeated occurrences, not just the first', () => {
  assert.equal(escapeXml('a & b & c'), 'a &amp; b &amp; c');
});

test('escapeXml leaves text without reserved characters unchanged', () => {
  assert.equal(escapeXml('純文字內容 123'), '純文字內容 123');
});

test('escapeXml does not double-escape an already-escaped ampersand', () => {
  // & is escaped to &amp; first; the resulting "&" inside "&amp;" must not be re-escaped.
  assert.equal(escapeXml('&amp;'), '&amp;amp;');
});

// ── splitLines ─────────────────────────────────────────────────────────────

test('splitLines normalizes CRLF and CR line endings to a single split', () => {
  assert.deepEqual(splitLines('a\r\nb\rc\nd'), ['a', 'b', 'c', 'd']);
});

test('splitLines preserves blank lines as empty strings', () => {
  assert.deepEqual(splitLines('a\n\nb'), ['a', '', 'b']);
});

test('splitLines trims trailing whitespace from each line', () => {
  assert.deepEqual(splitLines('hello   \nworld'), ['hello', 'world']);
});

test('splitLines wraps a line longer than 34 characters into multiple lines', () => {
  const long = 'a'.repeat(34) + 'b'.repeat(10);
  const result = splitLines(long);
  assert.deepEqual(result, ['a'.repeat(34), 'b'.repeat(10)]);
});

test('splitLines leaves a line exactly 34 characters long unsplit', () => {
  const exact = 'a'.repeat(34);
  assert.deepEqual(splitLines(exact), [exact]);
});

test('splitLines returns a single empty line for completely empty input', () => {
  assert.deepEqual(splitLines(''), ['']);
});

test('splitLines preserves one empty entry per whitespace-only line', () => {
  assert.deepEqual(splitLines('   \n  '), ['', '']);
});

// ── toPages ────────────────────────────────────────────────────────────────

test('toPages groups lines into pages of 12, joined by newlines', () => {
  const lines = Array.from({ length: 13 }, (_, i) => `line${i}`);
  const pages = toPages(lines);
  assert.equal(pages.length, 2);
  assert.equal(pages[0], lines.slice(0, 12).join('\n'));
  assert.equal(pages[1], lines[12]);
});

test('toPages keeps exactly 12 lines as a single page', () => {
  const lines = Array.from({ length: 12 }, (_, i) => `line${i}`);
  const pages = toPages(lines);
  assert.equal(pages.length, 1);
  assert.equal(pages[0], lines.join('\n'));
});

test('toPages returns a single empty page for empty input', () => {
  assert.deepEqual(toPages([]), ['']);
});

test('splitLines + toPages round-trip: total line count matches across all pages', () => {
  const raw = Array.from({ length: 30 }, (_, i) => `第 ${i} 行內容`).join('\n');
  const lines = splitLines(raw);
  const pages = toPages(lines);
  const totalLinesInPages = pages.reduce((sum, page) => sum + page.split('\n').length, 0);
  assert.equal(totalLinesInPages, lines.length);
});
