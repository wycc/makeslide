import test from 'node:test';
import assert from 'node:assert/strict';

import { isOverlayDismissKey, isBackdropClick } from './useOverlayDismiss';

test('isOverlayDismissKey matches only Escape', () => {
  assert.equal(isOverlayDismissKey('Escape'), true);
  assert.equal(isOverlayDismissKey('Enter'), false);
  assert.equal(isOverlayDismissKey('Esc'), false); // legacy IE value, not emitted by modern browsers
  assert.equal(isOverlayDismissKey(' '), false);
});

test('isBackdropClick is true only when the event hit the backdrop itself', () => {
  const backdrop = new EventTarget();
  const child = new EventTarget();
  assert.equal(isBackdropClick(backdrop, backdrop), true); // clicked the backdrop element
  assert.equal(isBackdropClick(child, backdrop), false); // bubbled up from a child
  assert.equal(isBackdropClick(null, backdrop), false);
});
