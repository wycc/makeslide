import test from 'node:test';
import assert from 'node:assert/strict';
import { WRAPPING_OVERLAY_TEXT_STYLE } from './overlayTextStyle';

test('WRAPPING_OVERLAY_TEXT_STYLE allows long overlay descriptions to wrap inside bounded callouts', () => {
  assert.equal(WRAPPING_OVERLAY_TEXT_STYLE.whiteSpace, 'pre-wrap');
  assert.equal(WRAPPING_OVERLAY_TEXT_STYLE.overflowWrap, 'anywhere');
  assert.equal(WRAPPING_OVERLAY_TEXT_STYLE.wordBreak, 'break-word');
  assert.equal(WRAPPING_OVERLAY_TEXT_STYLE.minWidth, 0);
  assert.equal(WRAPPING_OVERLAY_TEXT_STYLE.minHeight, 0);
});
