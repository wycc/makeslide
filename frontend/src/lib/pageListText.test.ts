import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPageListText } from './pageListText';

const LABELS = { prefix: 'p.', suffix: '', separator: ', ' };

test('formatPageListText returns empty string for an empty list', () => {
  assert.equal(formatPageListText([], LABELS), '');
});

test('formatPageListText sorts and joins with the separator', () => {
  assert.equal(formatPageListText([3, 1, 2], LABELS), 'p.1, p.2, p.3');
});

test('formatPageListText applies prefix and suffix labels', () => {
  assert.equal(
    formatPageListText([5, 2], { prefix: '第 ', suffix: ' 頁', separator: '、' }),
    '第 2 頁、第 5 頁',
  );
});

test('formatPageListText de-duplicates page numbers', () => {
  assert.equal(formatPageListText([2, 2, 1, 1], LABELS), 'p.1, p.2');
});
