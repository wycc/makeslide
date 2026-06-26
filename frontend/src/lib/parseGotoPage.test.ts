import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGotoPage } from './parseGotoPage';

test('parseGotoPage accepts valid in-range page numbers', () => {
  assert.equal(parseGotoPage('1', 10), 1);
  assert.equal(parseGotoPage('10', 10), 10);
  assert.equal(parseGotoPage('  5  ', 10), 5); // Number() trims whitespace
});

test('parseGotoPage floors fractional input', () => {
  assert.equal(parseGotoPage('3.9', 10), 3);
});

test('parseGotoPage rejects out-of-range values', () => {
  assert.equal(parseGotoPage('0', 10), null);
  assert.equal(parseGotoPage('-2', 10), null);
  assert.equal(parseGotoPage('11', 10), null);
});

test('parseGotoPage rejects empty and non-numeric input', () => {
  assert.equal(parseGotoPage('', 10), null);
  assert.equal(parseGotoPage('   ', 10), null);
  assert.equal(parseGotoPage('abc', 10), null);
});

test('parseGotoPage returns null when there are no pages', () => {
  assert.equal(parseGotoPage('1', 0), null);
});
