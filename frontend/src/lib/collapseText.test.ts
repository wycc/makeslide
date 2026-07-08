import test from 'node:test';
import assert from 'node:assert/strict';
import { collapseText } from './collapseText';

test('collapseText returns the text unchanged when it fits within maxLines', () => {
  assert.deepEqual(collapseText('a\nb\nc', 3), { text: 'a\nb\nc', hiddenLines: 0 });
  assert.deepEqual(collapseText('single', 5), { text: 'single', hiddenLines: 0 });
});

test('collapseText truncates to the first maxLines and reports hidden count', () => {
  const text = 'l1\nl2\nl3\nl4\nl5';
  assert.deepEqual(collapseText(text, 2), { text: 'l1\nl2', hiddenLines: 3 });
  assert.equal(text, 'l1\nl2\nl3\nl4\nl5'); // input untouched
});

test('collapseText treats a non-positive or non-finite maxLines as no collapse', () => {
  assert.deepEqual(collapseText('a\nb\nc', 0), { text: 'a\nb\nc', hiddenLines: 0 });
  assert.deepEqual(collapseText('a\nb\nc', -1), { text: 'a\nb\nc', hiddenLines: 0 });
  assert.deepEqual(collapseText('a\nb\nc', Number.NaN), { text: 'a\nb\nc', hiddenLines: 0 });
});
