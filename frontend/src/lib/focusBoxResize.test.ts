import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resizeFocusBox, FOCUS_BOX_MIN_SIZE_PCT, type FocusBox } from './focusBoxResize';

const START: FocusBox = { xPct: 20, yPct: 20, widthPct: 40, heightPct: 40 };

test('move translates the box and clamps the top-left corner into [0,100]', () => {
  assert.deepEqual(resizeFocusBox('move', START, 10, 5), { xPct: 30, yPct: 25, widthPct: 40, heightPct: 40 });
  // dragging far past the edge clamps origin to 0 / 100 (size unchanged)
  assert.deepEqual(resizeFocusBox('move', START, -50, 200), { xPct: 0, yPct: 100, widthPct: 40, heightPct: 40 });
});

test('moveOnly forces translation even for a resize handle', () => {
  // an 'se' handle would normally resize, but moveOnly (pointer-only effect) moves instead
  assert.deepEqual(resizeFocusBox('se', START, 10, 10, true), { xPct: 30, yPct: 30, widthPct: 40, heightPct: 40 });
});

test('east handle grows width and clamps to the container right edge', () => {
  assert.deepEqual(resizeFocusBox('e', START, 10, 0), { xPct: 20, yPct: 20, widthPct: 50, heightPct: 40 });
  // can't exceed 100 - xPct (=80)
  assert.deepEqual(resizeFocusBox('e', START, 100, 0).widthPct, 80);
});

test('west handle shifts the origin so the right edge stays fixed', () => {
  // drag west edge left by 10 → x:10, width:50; right edge (x+width) stays at 60
  assert.deepEqual(resizeFocusBox('w', START, -10, 0), { xPct: 10, yPct: 20, widthPct: 50, heightPct: 40 });
  const r = resizeFocusBox('w', START, -10, 0);
  assert.equal(r.xPct + r.widthPct, 60);
});

test('south and north handles resize height symmetrically to the e/w logic', () => {
  assert.deepEqual(resizeFocusBox('s', START, 0, 10), { xPct: 20, yPct: 20, widthPct: 40, heightPct: 50 });
  // north edge up by 10 → y:10, height:50, bottom edge stays at 60
  const n = resizeFocusBox('n', START, 0, -10);
  assert.deepEqual(n, { xPct: 20, yPct: 10, widthPct: 40, heightPct: 50 });
  assert.equal(n.yPct + n.heightPct, 60);
});

test('resize is clamped to the minimum box size', () => {
  // shrinking the east edge far past the minimum keeps width at FOCUS_BOX_MIN_SIZE_PCT
  assert.equal(resizeFocusBox('e', START, -100, 0).widthPct, FOCUS_BOX_MIN_SIZE_PCT);
  // corner 'se' clamps both width and height to the minimum
  const se = resizeFocusBox('se', START, -100, -100);
  assert.equal(se.widthPct, FOCUS_BOX_MIN_SIZE_PCT);
  assert.equal(se.heightPct, FOCUS_BOX_MIN_SIZE_PCT);
});

test('results are rounded to one decimal place', () => {
  assert.deepEqual(resizeFocusBox('move', START, 3.333, 1.111), { xPct: 23.3, yPct: 21.1, widthPct: 40, heightPct: 40 });
});
