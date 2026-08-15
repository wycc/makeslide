import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLineBoxes } from '../src/services/reactSlideTextDetect';

// The detector returns one box per line; a paragraph is what the user means to lift, and the line
// breaks inside it are what the extraction reproduces with <br />.

test('consecutive lines of one paragraph merge into a single box', () => {
  const merged = mergeLineBoxes([
    { x: 100, y: 100, width: 300, height: 30 },
    { x: 102, y: 138, width: 260, height: 30 },   // next line: same left, normal leading
    { x: 100, y: 176, width: 280, height: 30 },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.y, 100);
  assert.equal(merged[0]!.height, 206 - 100, 'spans from the first line to the last');
  assert.equal(merged[0]!.width, 300, 'as wide as its widest line');
});

test('a distant line, a differently indented one, and a different size stay separate', () => {
  const boxes = [
    { x: 100, y: 100, width: 300, height: 30 },
    { x: 100, y: 400, width: 300, height: 30 },   // far below: another block
    { x: 400, y: 438, width: 300, height: 30 },   // different left edge: another column
    { x: 100, y: 476, width: 300, height: 70 },   // much taller: a heading, not this paragraph
  ];
  assert.equal(mergeLineBoxes(boxes).length, 4);
});

test('merging is order-independent', () => {
  const boxes = [
    { x: 100, y: 176, width: 280, height: 30 },
    { x: 100, y: 100, width: 300, height: 30 },
    { x: 102, y: 138, width: 260, height: 30 },
  ];
  assert.equal(mergeLineBoxes(boxes).length, 1);
  assert.deepEqual(mergeLineBoxes([]), []);
});
