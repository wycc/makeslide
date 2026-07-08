import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnsi, stripAnsi, type AnsiSegment } from './ansi';

const ESC = '\x1b';

test('parseAnsi returns a single segment for plain text', () => {
  assert.deepEqual(parseAnsi('hello world'), [{ text: 'hello world' }]);
  assert.deepEqual(parseAnsi(''), []);
});

test('parseAnsi colours a segment and resets', () => {
  const input = `plain ${ESC}[31mred${ESC}[0m tail`;
  assert.deepEqual(parseAnsi(input), [
    { text: 'plain ' },
    { text: 'red', color: 'red' },
    { text: ' tail' },
  ] satisfies AnsiSegment[]);
});

test('parseAnsi handles bold and combined codes', () => {
  const input = `${ESC}[1;32mok${ESC}[0mdone`;
  assert.deepEqual(parseAnsi(input), [
    { text: 'ok', color: 'green', bold: true },
    { text: 'done' },
  ]);
});

test('parseAnsi maps bright colours (90-97) to their base colour', () => {
  assert.deepEqual(parseAnsi(`${ESC}[91mx`), [{ text: 'x', color: 'red' }]);
});

test('parseAnsi treats ESC[m and ESC[0m as reset; 39 clears colour; 22 clears bold', () => {
  assert.deepEqual(parseAnsi(`${ESC}[31m${ESC}[mplain`), [{ text: 'plain' }]);
  assert.deepEqual(parseAnsi(`${ESC}[31;1ma${ESC}[39mb`), [
    { text: 'a', color: 'red', bold: true },
    { text: 'b', bold: true },
  ]);
  assert.deepEqual(parseAnsi(`${ESC}[1ma${ESC}[22mb`), [{ text: 'a', bold: true }, { text: 'b' }]);
});

test('parseAnsi drops empty runs between adjacent escapes', () => {
  // No text between the two escapes → no empty segment emitted.
  assert.deepEqual(parseAnsi(`${ESC}[31m${ESC}[32mg`), [{ text: 'g', color: 'green' }]);
});

test('stripAnsi removes all escapes', () => {
  assert.equal(stripAnsi(`${ESC}[0;31mValueError${ESC}[0m: bad`), 'ValueError: bad');
  assert.equal(stripAnsi('no codes'), 'no codes');
});
