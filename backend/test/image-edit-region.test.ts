import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildRegionMask, isUsableRegion } from '../src/services/pageEditProposals';

/**
 * Whether an image edit is masked to the user's selection — docs/tutor-edit-tools.md §3.1.
 *
 * Asked to fix one bad line, a whole-image regeneration returns every other part of the slide
 * subtly changed as well, which is why the marked box has to reach the tool.
 */

test('a real selection is usable', () => {
  assert.equal(isUsableRegion({ x: 0.1, y: 0.2, w: 0.3, h: 0.25 }), true);
  // Full-slide selections are legitimate: the user dragged the whole thing on purpose.
  assert.equal(isUsableRegion({ x: 0, y: 0, w: 1, h: 1 }), true);
});

test('no selection means a whole-image edit, not a masked one', () => {
  assert.equal(isUsableRegion(undefined), false);
  assert.equal(isUsableRegion(null), false);
});

test('a stray click is not a selection', () => {
  // A click that registers as a 2×2px box would mask the edit down to nothing and the model would
  // return the slide unchanged — a wait and a bill for no visible result.
  assert.equal(isUsableRegion({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 }), false);
  assert.equal(isUsableRegion({ x: 0.5, y: 0.5, w: 0.4, h: 0 }), false);
});

test('a box outside the slide is rejected rather than clamped silently', () => {
  // These come from a drag the UI mis-measured; masking to them would edit the wrong place.
  assert.equal(isUsableRegion({ x: -0.1, y: 0.2, w: 0.3, h: 0.3 }), false);
  assert.equal(isUsableRegion({ x: 0.8, y: 0.2, w: 0.5, h: 0.3 }), false);
  assert.equal(isUsableRegion({ x: 0.2, y: 0.9, w: 0.3, h: 0.4 }), false);
});

test('non-finite values never reach the mask arithmetic', () => {
  assert.equal(isUsableRegion({ x: Number.NaN, y: 0.2, w: 0.3, h: 0.3 }), false);
  assert.equal(isUsableRegion({ x: 0.1, y: 0.2, w: Number.POSITIVE_INFINITY, h: 0.3 }), false);
});

test('the mask has a transparent hole exactly over the region', async () => {
  // The one that fails silently: `dest-out` subtracts the *source's* alpha, so punching the hole
  // with a transparent rectangle subtracts nothing and produces a mask with no hole at all. The
  // model then repaints the whole slide, which looks like the region was simply ignored. Asserted
  // on pixels because nothing else distinguishes the two masks.
  const W = 1536;
  const H = 1024;
  const region = { x: 0.25, y: 0.5, w: 0.25, h: 0.25 };
  const mask = await buildRegionMask(region);
  const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, W);
  assert.equal(info.height, H);
  const alphaAt = (x: number, y: number): number => data[(y * info.width + x) * info.channels + 3]!;

  const left = Math.round(region.x * W);
  const top = Math.round(region.y * H);
  const width = Math.round(region.w * W);
  const height = Math.round(region.h * H);
  assert.equal(alphaAt(left + Math.floor(width / 2), top + Math.floor(height / 2)), 0, 'inside must be transparent');
  assert.equal(alphaAt(10, 10), 255, 'outside must be opaque');
  assert.equal(alphaAt(left - 5, top - 5), 255, 'just outside the box must be opaque');
  assert.equal(alphaAt(left + width + 5, top + height + 5), 255, 'past the far corner must be opaque');
});

test('a region touching the slide edge stays inside the mask', async () => {
  // Rounding at the boundary must not produce a rectangle wider than the canvas, which sharp
  // rejects outright — a drag to the very edge is ordinary, not an edge case.
  const mask = await buildRegionMask({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 });
  const { info } = await sharp(mask).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1536);
  assert.equal(info.height, 1024);
});
