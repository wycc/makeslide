import test from 'node:test';
import assert from 'node:assert/strict';

import { csvEscape } from '../src/routes/pdfs/csv';

test('csvEscape passes through plain strings and numbers untouched', () => {
  assert.equal(csvEscape('hello'), 'hello');
  assert.equal(csvEscape(42), '42');
  assert.equal(csvEscape('選項 A'), '選項 A');
});

test('csvEscape returns empty string for null/undefined', () => {
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
});

test('csvEscape quotes and doubles embedded quotes', () => {
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape('line1\nline2'), '"line1\nline2"');
});

test('csvEscape quotes a lone carriage return (RFC 4180)', () => {
  assert.equal(csvEscape('a\rb'), '"a\rb"');
});

test('csvEscape defuses formula injection in string values', () => {
  assert.equal(csvEscape('=1+2'), "'=1+2");
  assert.equal(csvEscape('+49'), "'+49");
  assert.equal(csvEscape('-cmd'), "'-cmd");
  assert.equal(csvEscape('@SUM(A1)'), "'@SUM(A1)");
  // A formula-trigger char plus a comma is both defused and quoted.
  assert.equal(csvEscape('=HYPERLINK("x"),y'), '"\'=HYPERLINK(""x""),y"');
});

test('csvEscape never mangles legitimate negative numbers', () => {
  assert.equal(csvEscape(-1), '-1');
  assert.equal(csvEscape(-3.5), '-3.5');
});
