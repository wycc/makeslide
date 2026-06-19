import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapePdfText,
  sanitizePdfText,
  toUtf16BeHex,
  wrapText,
} from '../src/services/handoutPdf';

test('escapePdfText escapes backslashes and parentheses while preserving normal text', () => {
  assert.equal(escapePdfText('plain text'), 'plain text');
  assert.equal(escapePdfText('C:\\slides\\deck (draft)'), 'C:\\\\slides\\\\deck \\(draft\\)');
  assert.equal(escapePdfText('(left) and (right)'), '\\(left\\) and \\(right\\)');
});

test('sanitizePdfText normalizes CRLF, removes control characters, and preserves printable Chinese/English text', () => {
  const input = '第一行\r\nSecond line\u0000\u0008\u000B\u000C\u000Ekeep\t中文 English 123';

  assert.equal(sanitizePdfText(input), '第一行\nSecond line     keep\t中文 English 123');
});

test('wrapText keeps short strings on one line', () => {
  assert.deepEqual(wrapText('short text', 20), ['short text']);
});

test('wrapText prefers breaking at spaces', () => {
  assert.deepEqual(wrapText('alpha beta gamma', 12), ['alpha beta', 'gamma']);
});

test('wrapText splits long strings without spaces by maximum character count', () => {
  assert.deepEqual(wrapText('abcdefghijkl', 5), ['abcde', 'fghij', 'kl']);
});

test('wrapText counts mixed Chinese and English characters by code point', () => {
  assert.deepEqual(wrapText('中文ABC英文DEF', 5), ['中文ABC', '英文DEF']);
});

test('toUtf16BeHex encodes ASCII with UTF-16BE BOM', () => {
  assert.equal(toUtf16BeHex('AB'), 'FEFF00410042');
});

test('toUtf16BeHex encodes CJK text with UTF-16BE BOM', () => {
  assert.equal(toUtf16BeHex('中文'), 'FEFF4E2D6587');
});
