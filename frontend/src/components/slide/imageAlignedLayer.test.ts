import test from 'node:test';
import assert from 'node:assert/strict';
import { alignedRectChanged, imageRectWithin } from './ImageAlignedLayer';

const rect = (left: number, top: number, width: number, height: number): DOMRectReadOnly =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRectReadOnly;

test('the image box is expressed relative to the container, so a letterboxed or zoomed slide is still covered exactly', () => {
  // Fullscreen 1920×1080 container, 4:3 slide letterboxed in the middle.
  assert.deepEqual(imageRectWithin(rect(240, 0, 1440, 1080), rect(0, 0, 1920, 1080)), { left: 240, top: 0, width: 1440, height: 1080 });
  // Mid zoom effect: the transformed image's box has grown past the container edges; the layer follows it.
  assert.deepEqual(imageRectWithin(rect(-480, -270, 2880, 1620), rect(0, 0, 1920, 1080)), { left: -480, top: -270, width: 2880, height: 1620 });
});

test('sub-pixel jitter is not a change; a real move or resize is', () => {
  const a = { left: 240, top: 0, width: 1440, height: 1080 };
  assert.equal(alignedRectChanged(null, a), true, 'first measurement');
  assert.equal(alignedRectChanged(a, { ...a, left: 240.3 }), false);
  assert.equal(alignedRectChanged(a, { ...a, width: 1440.4 }), false);
  assert.equal(alignedRectChanged(a, { ...a, left: 241 }), true);
  assert.equal(alignedRectChanged(a, { ...a, height: 1082 }), true);
});
