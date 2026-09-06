import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WRAPPING_OVERLAY_TEXT_STYLE } from './overlayTextStyle';

test('WRAPPING_OVERLAY_TEXT_STYLE allows long overlay descriptions to wrap inside bounded callouts', () => {
  assert.equal(WRAPPING_OVERLAY_TEXT_STYLE.whiteSpace, 'pre-wrap');
  assert.equal(WRAPPING_OVERLAY_TEXT_STYLE.overflowWrap, 'anywhere');
  assert.equal(WRAPPING_OVERLAY_TEXT_STYLE.wordBreak, 'break-word');
  assert.equal(WRAPPING_OVERLAY_TEXT_STYLE.minWidth, 0);
  assert.equal(WRAPPING_OVERLAY_TEXT_STYLE.minHeight, 0);
});

test('the GSAP timeline presents opening effects as entered while paused at the page start', () => {
  const src = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), 'useGsapSlideTimeline.ts'), 'utf8');
  assert.match(src, /tl\.seek\(Math\.min\(pageEntryPresentationTime\(spec, currentTimeRef\.current, isPlayingRef\.current\), tl\.duration\(\)\), false\);/, 'initial seek');
  assert.match(src, /const target = pageEntryPresentationTime\(spec, currentTime, isPlayingRef\.current\);/, 'drift correction uses the same rule');
  assert.match(src, /const presented = pageEntryPresentationTime\(spec, currentTimeRef\.current, false\);/, 'pausing at the start re-presents the opening');
});
