import test from 'node:test';
import assert from 'node:assert/strict';
import {
  duplicateElement,
  isElementColor,
  joinColor,
  moveBox,
  newImageElement,
  newShapeElement,
  newTextElement,
  nudgeDelta,
  pasteTargetForPage,
  pageSupportsElements,
  reorderElement,
  resizeBox,
  rotationFromPointer,
  slideImageUrlForPage,
  splitColor,
} from './pageElements';

test('factories centre new elements and size pictures from their aspect ratio', () => {
  const text = newTextElement('hi');
  assert.equal(text.type, 'text');
  assert.ok(Math.abs(text.x + text.w / 2 - 0.5) < 1e-9, 'text centred horizontally');
  assert.equal(text.fontSize, 48);

  // A 2:1 picture on a 16:9 page: 40% wide → height = 0.4 × (16/9) / 2 ≈ 0.356.
  const wide = newImageElement('u.el-abcdefgh.png', { width: 200, height: 100 }, { width: 16, height: 9 });
  assert.equal(wide.w, 0.4);
  assert.ok(Math.abs(wide.h - (0.4 * 16) / 9 / 2) < 1e-9);
  // A very tall picture is capped at 80% of the page height and narrows to match.
  const tall = newImageElement('u.el-abcdefgh.png', { width: 100, height: 1000 }, { width: 16, height: 9 });
  assert.equal(tall.h, 0.8);
  assert.ok(tall.w < 0.4);
  assert.ok(tall.x >= 0 && tall.y >= 0);

  const line = newShapeElement('arrow');
  assert.equal(line.fill, null);
  assert.equal(line.stroke, '#111111');
  const rect = newShapeElement('rect');
  assert.equal(rect.fill, '#3b82f6');
  assert.equal(rect.w, rect.h);

  const copy = duplicateElement(rect);
  assert.notEqual(copy.id, rect.id);
  assert.ok(copy.x > rect.x && copy.y > rect.y);
});

test('colour helpers round-trip hex8 and rgba through the picker representation', () => {
  assert.deepEqual(splitColor('#ff0000'), { hex: '#ff0000', alpha: 1 });
  assert.deepEqual(splitColor('#FF000080'), { hex: '#ff0000', alpha: 0.502 });
  assert.deepEqual(splitColor('rgba(0, 128, 255, 0.5)'), { hex: '#0080ff', alpha: 0.5 });
  assert.deepEqual(splitColor(null), { hex: '#000000', alpha: 1 });
  assert.equal(joinColor('#00FF00', 1), '#00ff00');
  assert.equal(joinColor('#00ff00', 0.5), '#00ff0080');
  assert.equal(joinColor('garbage', 1), '#000000');
  assert.equal(isElementColor(joinColor('#123456', 0.25)), true);
  assert.equal(isElementColor('red'), false);
});

test('resizeBox keeps the opposite edge fixed and can hold the aspect ratio', () => {
  const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };
  const se = resizeBox(box, 'se', 0.1, 0.1);
  assert.equal(se.x, 0.2);
  assert.equal(se.y, 0.2);
  assert.ok(Math.abs(se.w - 0.5) < 1e-9 && Math.abs(se.h - 0.3) < 1e-9);
  const nw = resizeBox(box, 'nw', 0.1, 0.05);
  assert.ok(Math.abs(nw.x + nw.w - 0.6) < 1e-9, 'right edge unchanged');
  assert.ok(Math.abs(nw.y + nw.h - 0.4) < 1e-9, 'bottom edge unchanged');
  assert.ok(Math.abs(nw.w - 0.3) < 1e-9 && Math.abs(nw.h - 0.15) < 1e-9);
  const tiny = resizeBox(box, 'e', -0.9, 0);
  assert.ok(tiny.w >= 0.01, 'never collapses below the minimum');
  const aspect = resizeBox(box, 'se', 0.2, 0, true);
  assert.ok(Math.abs(aspect.w / aspect.h - 2) < 1e-9, 'aspect 2:1 preserved');
  const north = resizeBox(box, 'n', 0, -0.1);
  assert.ok(Math.abs(north.h - 0.3) < 1e-9 && Math.abs(north.y - 0.1) < 1e-9);
});

test('moveBox never pushes an element entirely off the page', () => {
  const box = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
  assert.deepEqual(moveBox(box, 0.1, -0.1), { x: 0.6, y: 0.4, w: 0.2, h: 0.2 });
  const far = moveBox(box, 5, 5);
  assert.ok(far.x <= 0.98 && far.y <= 0.98);
  const back = moveBox(box, -5, -5);
  assert.ok(back.x >= -0.2 + 0.02 - 1e-9 && back.y >= -0.2 + 0.02 - 1e-9);
});

test('rotationFromPointer measures from straight up and snaps to 15° with Shift', () => {
  const c = { x: 100, y: 100 };
  assert.equal(rotationFromPointer(c, { x: 100, y: 0 }), 0);
  assert.equal(rotationFromPointer(c, { x: 200, y: 100 }), 90);
  assert.equal(rotationFromPointer(c, { x: 0, y: 100 }), -90);
  assert.equal(rotationFromPointer(c, { x: 100, y: 200 }), 180);
  assert.equal(rotationFromPointer(c, { x: 186, y: 50 }, true), 60);
});

test('nudgeDelta moves one reference pixel, ten with Shift', () => {
  assert.deepEqual(nudgeDelta('ArrowRight', false), { dx: 1 / 1920, dy: 0 });
  assert.deepEqual(nudgeDelta('ArrowUp', true), { dx: 0, dy: -10 / 1080 });
  assert.equal(nudgeDelta('a', false), null);
});

test('reorderElement moves within the stacking order', () => {
  const els = [newShapeElement('rect', { id: 'a' }), newShapeElement('rect', { id: 'b' }), newShapeElement('rect', { id: 'c' })];
  assert.deepEqual(reorderElement(els, 'a', 'up').map((e) => e.id), ['b', 'a', 'c']);
  assert.deepEqual(reorderElement(els, 'a', 'top').map((e) => e.id), ['b', 'c', 'a']);
  assert.deepEqual(reorderElement(els, 'c', 'down').map((e) => e.id), ['a', 'c', 'b']);
  assert.deepEqual(reorderElement(els, 'c', 'bottom').map((e) => e.id), ['c', 'a', 'b']);
  assert.equal(reorderElement(els, 'zzz', 'up'), els);
});

test('paste routing: image pages add an element, React pages swap the base, notebooks ignore', () => {
  assert.equal(pasteTargetForPage('static-image'), 'element');
  assert.equal(pasteTargetForPage('gsap-image'), 'element');
  assert.equal(pasteTargetForPage(undefined), 'element');
  assert.equal(pasteTargetForPage('react'), 'base');
  assert.equal(pasteTargetForPage('notebook'), 'ignore');
  assert.equal(pageSupportsElements('react'), false);
  assert.equal(pageSupportsElements('static-image'), true);
});

test('slideImageUrlForPage shows the base under a layer and the composite otherwise', () => {
  const page = { image_url: 'api/x/image', thumbnail_url: 'api/x/thumb', base_image_url: 'api/x/base-image', elements: [] as unknown[] };
  assert.equal(slideImageUrlForPage(page), 'api/x/image');
  assert.equal(slideImageUrlForPage(page, false, true), 'api/x/thumb', 'no layer → the thumbnail is fine');
  assert.equal(slideImageUrlForPage({ ...page, elements: [{ id: 'a' }] }, false, true), 'api/x/base-image', 'a layer needs the base at full size');
  assert.equal(slideImageUrlForPage({ ...page, elements: [{ id: 'a' }] }), 'api/x/base-image');
  assert.equal(slideImageUrlForPage(page, true), 'api/x/base-image', 'an unsaved draft counts');
  assert.equal(slideImageUrlForPage({ image_url: 'api/x/image', elements: [{ id: 'a' }] }), 'api/x/image', 'no base URL → composite');
});
