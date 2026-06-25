import test from 'node:test';
import assert from 'node:assert/strict';
import { escapePdfText, sanitizePdfText, wrapText, toUtf16BeHex } from '../src/services/handoutPdf';

test('escapePdfText escapes backslashes and parentheses for PDF string syntax', () => {
  assert.equal(escapePdfText('a(b)c'), 'a\\(b\\)c');
  assert.equal(escapePdfText('a\\b'), 'a\\\\b');
  assert.equal(escapePdfText('plain'), 'plain');
});

test('escapePdfText escapes backslashes first so an escaped paren is not double-escaped', () => {
  // input "\(" -> backslash becomes "\\", then "(" becomes "\(" => "\\\("
  assert.equal(escapePdfText('\\('), '\\\\\\(');
});

test('sanitizePdfText normalizes CRLF and replaces control chars but keeps tab/newline', () => {
  assert.equal(sanitizePdfText('a\r\nb'), 'a\nb');
  const withControls = `a${String.fromCharCode(0)}b${String.fromCharCode(7)}c`;
  assert.equal(sanitizePdfText(withControls), 'a b c');
  assert.equal(sanitizePdfText('keep\ttab\nnewline'), 'keep\ttab\nnewline');
});

test('wrapText returns the input as one line when within maxChars', () => {
  assert.deepEqual(wrapText('short', 20), ['short']);
});

test('wrapText skips empty paragraphs and splits on blank lines', () => {
  assert.deepEqual(wrapText('', 10), []);
  assert.deepEqual(wrapText('para1\n\npara2', 20), ['para1', 'para2']);
});

test('wrapText breaks at the last space within maxChars', () => {
  assert.deepEqual(wrapText('aaaa bbbb', 6), ['aaaa', 'bbbb']);
});

test('wrapText hard-breaks space-less multibyte text by character count', () => {
  assert.deepEqual(wrapText('一二三四五', 3), ['一二三', '四五']);
});

test('toUtf16BeHex emits a BOM and big-endian code units in uppercase hex', () => {
  assert.equal(toUtf16BeHex(''), 'FEFF');
  assert.equal(toUtf16BeHex('A'), 'FEFF0041');
  assert.equal(toUtf16BeHex('中'), 'FEFF4E2D');
});
