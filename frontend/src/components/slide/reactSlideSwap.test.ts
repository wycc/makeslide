import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source-level guards for changing which React slide is on screen without a flash.
 *
 * An iframe's document is replaced by assigning `srcDoc`, and the browser blanks the frame while
 * the new document loads. The slide's own background is `#0f172a` by default, so what the viewer
 * saw between two React pages was the slide going black and coming back.
 *
 * The fix is a second, invisible iframe: the replacement loads there and is only promoted once it
 * reports itself painted, leaving the outgoing page up until then. These pin the parts that fail
 * silently — an invisible frame that is never laid out may never paint, a sandbox that never
 * reports ready must not strand the viewer, and the live frame must remain the one that receives
 * the styling messages.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.resolve(here, './ReactSlideFrame.tsx'), 'utf8');

test('the visible frame shows the live document, and the replacement loads beside it', () => {
  assert.match(src, /srcDoc=\{liveDoc\}/, 'the visible iframe renders the live document');
  assert.match(src, /srcDoc=\{pendingDoc\}/, 'and the replacement has its own frame');
  // Only built when there is something to swap; two sandboxes running forever would double the
  // cost of every page.
  assert.match(src, /\{pendingDoc !== null \? \(/);
});

test('the pending frame is hidden but still laid out, so it actually paints', () => {
  const start = src.indexOf('ref={pendingFrameRef}');
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('/>', start));
  assert.match(block, /opacity: 0/);
  assert.match(block, /pointerEvents: 'none'/);
  assert.match(block, /aria-hidden/);
  // A frame that is display:none or zero-sized may never paint, and a sandbox that never paints
  // never reports itself ready — every page change would then wait for the timeout.
  assert.doesNotMatch(block, /display: 'none'/);
  assert.match(block, /width: `\$\{box\.width\}px`/);
  assert.match(block, /height: `\$\{box\.height\}px`/);
});

test('promotion happens on the replacement reporting itself painted', () => {
  const start = src.indexOf('const fromPending =');
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('window.addEventListener', start));
  assert.match(block, /if \(event\.data\.type === 'ms-slide-ready'\) promotePending\(\)/);
  // Anything else the incoming page says belongs to a page nobody is looking at yet.
  assert.match(block, /return;/);
  // A page that fails before its first paint still has to be reported, or the error is swallowed.
  assert.match(block, /ms-slide-error'\) onError\?\.\(event\.data\.message\)/);
});

test('a replacement that never reports ready is shown anyway', () => {
  // Otherwise a runtime error before first paint, or a stalled asset, would leave the viewer
  // looking at the previous page indefinitely — worse than the flash this replaces.
  assert.match(src, /const PENDING_SWAP_TIMEOUT_MS = \d+;/);
  assert.match(src, /setTimeout\(promotePending, PENDING_SWAP_TIMEOUT_MS\)/);
  assert.match(src, /clearTimeout\(timer\)/, 'and the timer is cleared when it is not needed');
});

test('the document is built with the step the page is actually on', () => {
  // The step used to be captured on mount. A rebuild happens when the page changes, so page 12's
  // document would have been built as if still on page 3's fourth step — the build would open
  // part-revealed.
  assert.match(src, /const stepRef = useRef\(step\);\s*\n\s*stepRef\.current = step;/);
  assert.match(src, /step: stepRef\.current,/);
  assert.doesNotMatch(src, /initialStepRef/);
});

test('styling messages keep going to the frame on screen', () => {
  // Overrides, tokens and text layers are pushed into the live sandbox; sending them to the
  // pending one would style a document nobody is looking at and lose the edit on promotion.
  const pushes = src.match(/frameRef\.current\?\.contentWindow\?\.postMessage/g) ?? [];
  assert.ok(pushes.length >= 2, `expected the live frame to receive the pushes, found ${pushes.length}`);
  assert.doesNotMatch(src, /pendingFrameRef\.current\?\.contentWindow\?\.postMessage/);
});
