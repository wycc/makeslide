import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_DETACHED_HEIGHT,
  MIN_DETACHED_WIDTH,
  clampDetachedEditorRect,
  defaultDetachedEditorRect,
  parseStoredDetachedEditorRect,
  restoreDetachedEditorRect,
} from './detachedEditorRect';

const VIEWPORT = { width: 1440, height: 900 };

test('a stored rect that already fits is restored unchanged', () => {
  // The whole point of storing it: the placement the user chose comes back as they left it.
  const rect = { x: 120, y: 90, width: 820, height: 500 };
  assert.deepEqual(restoreDetachedEditorRect(JSON.stringify(rect), VIEWPORT), rect);
});

test('a rect saved on a bigger screen is fitted to this one', () => {
  // Restoring it verbatim would put the window mostly off-screen — unreachable is no better than
  // not having saved it.
  const restored = restoreDetachedEditorRect(
    JSON.stringify({ x: 2400, y: 1300, width: 2000, height: 1400 }),
    VIEWPORT,
  );
  assert.ok(restored.width <= VIEWPORT.width);
  assert.ok(restored.height <= VIEWPORT.height);
  assert.ok(restored.x < VIEWPORT.width, 'left edge stays on screen');
  assert.ok(restored.y < VIEWPORT.height, 'title bar stays reachable');
});

test('clamping never shrinks the window below a usable size', () => {
  const restored = clampDetachedEditorRect({ x: 0, y: 0, width: 10, height: 10 }, VIEWPORT);
  assert.equal(restored.width, MIN_DETACHED_WIDTH);
  assert.equal(restored.height, MIN_DETACHED_HEIGHT);
});

test('clamping copes with a viewport smaller than the minimum window', () => {
  // A phone-sized viewport must not produce a negative size.
  const viewport = { width: 200, height: 150 };
  const restored = clampDetachedEditorRect({ x: 500, y: 500, width: 900, height: 600 }, viewport);
  assert.equal(restored.width, MIN_DETACHED_WIDTH);
  assert.equal(restored.height, MIN_DETACHED_HEIGHT);
  // The window is wider than the screen, so it can only sit flush left; its title bar still has to
  // land inside the viewport.
  assert.equal(restored.x, 0);
  assert.ok(restored.y >= 0 && restored.y < viewport.height);
});

test('a missing, malformed or incomplete stored value falls back to the default placement', () => {
  const fallback = defaultDetachedEditorRect(VIEWPORT);
  for (const raw of [null, '', 'not json', '{}', '[]', 'null', JSON.stringify({ x: 1, y: 2, width: 3 })]) {
    assert.deepEqual(restoreDetachedEditorRect(raw, VIEWPORT), fallback, `raw: ${String(raw)}`);
  }
});

test('non-finite numbers are rejected rather than placing the window at NaN', () => {
  assert.equal(parseStoredDetachedEditorRect('{"x":null,"y":0,"width":800,"height":500}'), null);
  assert.equal(parseStoredDetachedEditorRect(`{"x":0,"y":0,"width":800,"height":${JSON.stringify(null)}}`), null);
  // JSON has no NaN/Infinity literal, so this is the shape a hand-edited value takes.
  assert.equal(parseStoredDetachedEditorRect('{"x":"80","y":"120","width":"900","height":"500"}'), null);
});

test('the default placement fits inside a small viewport', () => {
  const rect = defaultDetachedEditorRect({ width: 400, height: 300 });
  assert.ok(rect.width >= MIN_DETACHED_WIDTH);
  assert.ok(rect.height >= MIN_DETACHED_HEIGHT);
});
