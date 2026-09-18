import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source-level guards for changing which React slide is on screen without a flash.
 *
 * An iframe's document is replaced by assigning `srcDoc`, and the browser blanks the frame while
 * the new document loads; the slide's own background is `#0f172a` by default, so that reads as the
 * slide going black. The replacement therefore loads in a second iframe and is shown only once it
 * reports itself painted.
 *
 * The first version of that got the last step wrong: it copied the painted document into the
 * visible iframe's `srcDoc`, which reloads the visible iframe and discards the copy that had just
 * painted. Measured frame by frame in fullscreen, that reload was a ~75ms black frame on every page
 * change. The guards below pin the version that keeps the painted element instead.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.resolve(here, './ReactSlideFrame.tsx'), 'utf8');

test('each document lives in its own keyed iframe, so promotion never reloads one', () => {
  assert.match(src, /\{slots\.map\(\(slot\) => \{/);
  assert.match(src, /key=\{slot\.key\}/);
  assert.match(src, /srcDoc=\{slot\.doc\}/, 'a slot keeps the document it was created with');
  // The broken version: a single visible iframe whose srcDoc is re-assigned on promotion.
  assert.doesNotMatch(src, /srcDoc=\{liveDoc\}/);
  assert.doesNotMatch(src, /setLiveDoc\(/);
});

test('promotion switches which slot is live and drops the other', () => {
  const start = src.indexOf('const promote = useCallback(');
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf('}, [markPainted]);', start));
  assert.match(body, /setLiveKey\(key\);/);
  assert.match(body, /setSlots\(\[slot\]\);/, 'only the promoted slot remains');
  // Nothing about the promoted document is re-assigned anywhere.
  assert.doesNotMatch(body, /doc:/);
});

test('a new document starts a slot beside the live one instead of replacing it', () => {
  const start = src.indexOf('useEffect(() => {\n    const current = slotsRef.current;');
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf('}, [srcDoc]);', start));
  assert.match(body, /setSlots\(live \? \[live, next\] : \[next\]\);/);
  // Returning to what is already on screen cancels a replacement in flight.
  assert.match(body, /if \(live && live\.doc === srcDoc\)/);
});

test('a loading slot is invisible but still laid out, so it actually paints', () => {
  assert.match(src, /opacity: isLive && everPainted \? 1 : 0,/);
  assert.match(src, /pointerEvents: isLive && \(inspect \|\| interactive\) \? 'auto' : 'none',/);
  assert.doesNotMatch(src, /display: 'none'/);
  assert.match(src, /width: `\$\{box\.width\}px`,\s*\n\s*height: `\$\{box\.height\}px`,/);
});

test('messages are attributed to the slot that sent them', () => {
  const start = src.indexOf('let fromKey: number | null = null;');
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf("if (event.data.type === 'ms-slide-select')", start));
  assert.match(block, /event\.source === el\.contentWindow/);
  // From a loading slot only 'ready' (promote) and 'error' mean anything.
  assert.match(block, /if \(fromKey !== liveKeyRef\.current\) \{[\s\S]*?promote\(fromKey\)[\s\S]*?onError[\s\S]*?return;/);
});

test('a replacement that never reports ready is shown anyway', () => {
  assert.match(src, /const PENDING_SWAP_TIMEOUT_MS = \d+;/);
  assert.match(src, /setTimeout\(\(\) => promote\(pendingKey\), PENDING_SWAP_TIMEOUT_MS\)/);
});

test('styling keeps going to the frame on screen, and reaches a promoted frame at once', () => {
  const pushes = src.match(/liveFrame\(\)\?\.contentWindow\?\.postMessage/g) ?? [];
  assert.ok(pushes.length >= 6, `expected every push to target the live frame, found ${pushes.length}`);
  // liveKey in each dependency list, so a step or override changed while the replacement loaded is
  // re-sent the moment it becomes live.
  const deps = src.match(/\}, \[ready, liveKey, liveFrame,/g) ?? [];
  assert.equal(deps.length, pushes.length, 'every push re-runs when the live slot changes');
});

test('the document is built with the step the page is actually on', () => {
  assert.match(src, /const stepRef = useRef\(step\);\s*\n\s*stepRef\.current = step;/);
  assert.match(src, /step: stepRef\.current,/);
});
