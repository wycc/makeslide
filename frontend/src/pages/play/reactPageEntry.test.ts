import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source-level guards for entering a React page without a black frame.
 *
 * Three things put the slide's dark background on screen on the way into a React page, and each
 * is pinned here because each fails silently — nothing errors, the page just flashes:
 *
 *  1. The code and its pictures were fetched separately. The code arrived first, so the sandbox
 *     built a document from the new page's code and the previous page's pictures; a step-built
 *     page is nothing but pictures, so that document was the bare background.
 *  2. The sandbox reported itself ready one frame after render(), before React committed and long
 *     before the pictures decoded, so a swap waiting for "ready" still swapped in a blank page.
 *  3. Coming from a picture page, the frame mounted fresh and showed its document at once, while
 *     the only React content loaded was an older page's.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the code and its pictures are loaded together and take effect together', () => {
  const hook = read('./usePageReactSlide.ts');
  assert.match(hook, /Promise\.all\(\[\s*\n\s*fetchPageReactSlide\(pdfId, pageNumber, shareToken\),\s*\n\s*fetchReactSlideAssets\(pdfId, pageNumber, shareToken\)/);
  // Set before the code, in the same tick, so no document is ever built from one without the other.
  const assetsAt = hook.indexOf('setReactAssets(assets);');
  const compiledAt = hook.indexOf('setReactCompiled(data.compiled);');
  assert.ok(assetsAt > 0 && compiledAt > assetsAt, '素材要和程式碼一起、而且先於程式碼生效');
  assert.match(hook, /setReactLoadedPageNumber\(pageNumber\)/, 'and it records which page they belong to');
  // The separate refresh (for a picture inserted while editing) must not refetch what the load just
  // brought, or it rebuilds a document that has just painted.
  assert.match(hook, /if \(assetsLoadedForCodeRef\.current === reactCode\) return;/);
});

test('the sandbox reports ready only once the slide is actually painted', () => {
  const lib = read('../../lib/reactSlide.ts');
  const start = lib.indexOf('var readySent = false;');
  assert.ok(start > 0, 'ready has its own gate');
  const block = lib.slice(start, lib.indexOf('} catch (e) {', start));
  assert.match(block, /root\.childNodes\.length > 0/, 'after React has committed');
  assert.match(block, /img\.decode/, 'and after every picture has decoded');
  assert.match(block, /Promise\.all\(pending\)\.then\(sendReady, sendReady\)/);
  // A picture that never loads must not hold the page hostage.
  assert.match(block, /setTimeout\(sendReady, \d+\)/);
  // The old one-frame report must be gone, or it would still win the race.
  assert.doesNotMatch(lib, /requestAnimationFrame\(function \(\) \{\s*\n\s*syncDom\(\);\s*\n\s*post\(\{ type: 'ms-slide-ready' \}\);/);
});

test('a freshly mounted frame stays invisible behind the previous picture until it paints', () => {
  const frame = read('../../components/slide/ReactSlideFrame.tsx');
  assert.match(frame, /opacity: isLive && everPainted \? 1 : 0,/);
  // Measured before the first paint, or the first frame lays the canvas out at 1920×1080.
  assert.match(frame, /useLayoutEffect\(\(\) => \{\s*\n\s*const el = containerRef\.current;\s*\n\s*if \(!el\) return;\s*\n\s*const measure = \(\) => \{/);
  assert.doesNotMatch(frame, /<img/, 'the poster is not a new picture inside the frame');
  // "Painted" comes from the sandbox's report or a promotion — never the iframe's load event,
  // which fires before React has rendered anything.
  const onLoad = frame.match(/onLoad=\{\(\) => ([^}]*)\}/);
  assert.ok(onLoad, 'the live iframe has a load handler');
  assert.doesNotMatch(onLoad![1]!, /markPainted/);
  assert.match(frame, /if \(event\.data\.type === 'ms-slide-ready'\) \{\s*\n\s*setReady\(true\);\s*\n\s*markPainted\(\);/);
  // The outer backstops must outlast the sandbox's own cap on waiting for pictures, or they swap in
  // a half-decoded page first.
  const pending = Number(/const PENDING_SWAP_TIMEOUT_MS = (\d+);/.exec(frame)![1]);
  const lib = read('../../lib/reactSlide.ts');
  const sandboxCap = Number(/setTimeout\(sendReady, (\d+)\)/.exec(lib)![1]);
  assert.ok(pending > sandboxCap, `外層逾時（${pending}ms）必須比沙盒等圖片的上限（${sandboxCap}ms）長`);
});

test('the poster is the image branch\'s own picture element, kept rather than loaded again', () => {
  const renderer = read('../../components/slide/SlideRenderer.tsx');
  const branchAt = renderer.indexOf('if (showsReactSlide && reactSlide) {');
  assert.ok(branchAt > 0, 'the React branch');
  const branch = renderer.slice(branchAt, renderer.indexOf('\n  }\n', branchAt));
  // React keeps a DOM node only when the same element type sits at the same child position. The
  // image branch's picture is the wrapper's first child, so the poster must be too — and nothing
  // may be put in front of it. A new element had to fetch its picture again, and Chrome draws a
  // loading picture as an outline with an icon over the slide's dark background.
  const firstChild = branch.slice(branch.indexOf('onPointerMove={onWrapperPointerMove}\n      >') + 45);
  assert.match(firstChild, /^\s*\{\/\*[\s\S]*?\*\/\}\s*\n\s*\{posterSrc \? \(\s*\n\s*<img/, '海報必須是外框的第一個子元素，才會沿用前一頁的 <img>');
  const imageBranch = renderer.slice(renderer.indexOf('if (!animated || animationFailed) {'));
  assert.match(imageBranch, /onPointerMove=\{onWrapperPointerMove\}>\s*\n\s*\{img\}/, 'and the image branch\'s picture is its first child');
  // Dropped once the frame has painted, and the frame's own report is what says so.
  assert.match(branch, /const posterSrc = !reactFramePainted \? reactSlide\.posterSrc : null;/);
  assert.match(branch, /onPainted=\{handleReactFramePainted\}/);
  assert.match(renderer, /if \(!showsReactSlide\) setReactFramePainted\(false\);/);
  // A poster that is not already loaded stays hidden rather than showing the loading outline.
  assert.match(renderer, /if \(!el \|\| el\.complete\) return;\s*\n\s*el\.style\.visibility = 'hidden';/);
});

test('while a React page loads, the previous screen is held rather than a stale or bare slide', () => {
  const playPage = read('../PlayPage.tsx');
  assert.match(playPage, /reactSlideState\.reactLoadedPageNumber === currentPage\.page_number/);
  assert.match(playPage, /if \(last\?\.kind === 'image'\) return \{ useReactContent: false, holdImageSrc: last\.src, posterSrc: null \};/);
  for (const file of ['./PlayPageSlidePanel.tsx', './PlayPageFullscreen.tsx']) {
    const src = read(file);
    // Only the loaded content (current, or the frame's own previous page) reaches the frame …
    assert.match(src, /currentPage\?\.render_type === 'react' && reactStage\.useReactContent/, `${file}: React content is gated`);
    assert.match(src, /posterSrc: reactStage\.posterSrc,/);
    // … and a held picture wins the image slot while this page is not ready.
    assert.match(src, /src=\{reactStage\.holdImageSrc \?\? displayedImageSrc/, `${file}: the previous picture is held`);
  }
});
