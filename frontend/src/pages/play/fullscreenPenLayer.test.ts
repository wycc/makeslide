import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 全螢幕的畫筆要在最上層（使用者要求，2026-09-14）：留言／備註面板開著時也要能在上面畫。
 *
 * 畫布原本是 SlideRenderer 的 child、住在 GSAP 的 stage 裡；stage 有 will-change: transform，
 * 自成 stacking context，裡面的 z-index 再大也壓不過外層 z-40 的面板。修法是把全螢幕的畫布搬到
 * 容器層、用 ImageAlignedLayer 貼齊圖片的實際範圍（縮放動畫時每一幀跟著走），放在 z-[45]：
 * 面板（z-40）之下不變、UI 按鈕抬到 z-[46] 好讓畫筆開著時仍按得到。沒有渲染測試環境，比照
 * fullscreenTopBar.test.ts 以原始碼層級釘住。
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');
const FULLSCREEN = read('./PlayPageFullscreen.tsx');

const zOf = (cls: string): number => {
  const m = /^z-(?:\[(\d+)\]|(\d+))$/.exec(cls);
  assert.ok(m, `not a z-index class: ${cls}`);
  return Number(m?.[1] ?? m?.[2]);
};

test('the fullscreen canvas lives in an image-aligned layer at container level, not inside the slide stage', () => {
  const layer = /<ImageAlignedLayer\n([\s\S]*?)<\/ImageAlignedLayer>/.exec(FULLSCREEN)?.[0] ?? '';
  assert.ok(layer, 'the pen layer exists');
  assert.match(layer, /ref=\{drawingCanvasFullscreenRef\}/, 'it holds the fullscreen DrawingCanvas');
  assert.match(layer, /imageRef=\{fullscreenImageRef\}/, 'pinned to the picture (follows zoom effects)');
  assert.match(layer, /fallbackRef=\{fullscreenSlideBoxRef\}/, 'React / notebook pages have no <img>: fall back to the slide box');
  assert.match(layer, /containerRef=\{fullscreenContainerRef\}/);
  assert.match(layer, /style=\{\{ pointerEvents: 'none' \}\}/, 'the layer itself never eats clicks — only the enabled canvas does');
  // The non-split SlideRenderer must not carry the canvas any more.
  const slide = /imgClassName="max-h-screen max-w-screen object-contain"[\s\S]*?<\/SlideRenderer>/.exec(FULLSCREEN)?.[0] ?? '';
  assert.ok(slide, 'found the fullscreen SlideRenderer');
  assert.doesNotMatch(slide, /<DrawingCanvas/, 'no canvas inside the stage (it could never be painted above the panels there)');
  assert.match(slide, /wrapperRef=\{fullscreenSlideBoxRef\}/, 'the slide box ref is what the fallback aligns to');
});

test('the pen sits above the content panels and below the UI chrome', () => {
  const pen = zOf(/<ImageAlignedLayer\n[\s\S]*?className="(z-\[\d+\])"/.exec(FULLSCREEN)?.[1] ?? '');
  for (const [file, label] of [
    ['./FullscreenCommentsPanel.tsx', 'comments'],
    ['./PageNoteEditor.tsx', 'notes'],
  ] as const) {
    const cls = /absolute left-1\/2 top-16 (z-\S+)/.exec(read(file))?.[1] ?? '';
    assert.ok(zOf(cls) < pen, `${label} panel (${cls}) stays under the pen so strokes land on it`);
  }
  for (const [pattern, label] of [
    [/absolute inset-x-0 top-0 (z-\S+) grid grid-cols-\[1fr_auto_1fr\]/, 'top badge bar'],
    [/absolute left-2 top-2 (z-\S+) flex flex-col gap-1\.5/, 'drawing toolbar'],
    [/absolute left-4 top-32 (z-\S+) flex flex-col items-start/, 'question badges'],
  ] as const) {
    const cls = pattern.exec(FULLSCREEN)?.[1] ?? '';
    assert.ok(zOf(cls) > pen, `${label} (${cls}) must stay clickable while the pen is on`);
  }
  // Dialogs that take over the screen still cover the pen.
  assert.ok(pen < 100, 'below the fullscreen dialogs (z-[120]+) and the fullscreen root itself');
});

test('SlideRenderer hands out its outer box for every page kind', () => {
  const renderer = read('../../components/slide/SlideRenderer.tsx');
  assert.match(renderer, /wrapperRef\?: Ref<HTMLDivElement>;/);
  const uses = renderer.match(/ref=\{wrapperRef\}/g) ?? [];
  assert.ok(uses.length >= 4, `notebook, react, static and animated wrappers all expose it (got ${uses.length})`);
});
