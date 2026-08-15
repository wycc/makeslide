import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  buildExtractTextMessages,
  buildRegionMask,
  clampExtractedFontSize,
  compositeErasedRegion,
  computeEraseContext,
  fitFontSizeToBox,
  normalizeExtractedColor,
  regionToPixels,
} from '../src/services/reactSlideTextExtract';
import {
  MAX_TEXT_LAYER_FONT_PX,
  MIN_TEXT_LAYER_FONT_PX,
  sanitizeTextLayers,
  textLayerCss,
  type ReactSlideTextLayer,
} from '../src/services/reactSlide';

/**
 * Extraction turns pixels into text, and every number it produces ends up in CSS. These tests pin
 * the two things that make the result usable rather than merely present: a font size the region can
 * actually hold, and layers that cannot carry anything hostile into the sandbox.
 */

function layer(overrides: Partial<ReactSlideTextLayer> = {}): ReactSlideTextLayer {
  return {
    id: 'abc123',
    xPct: 10,
    yPct: 20,
    widthPct: 40,
    heightPct: 10,
    text: '線性代數',
    fontSizePx: 48,
    color: '#ffffff',
    fontWeight: 700,
    fontFamily: 'heading',
    textAlign: 'left',
    lineHeight: 1.2,
    ...overrides,
  };
}

// ── font size ──────────────────────────────────────────────────────────────

test('an oversized estimate is capped by what the region can hold', () => {
  // 100px tall, one line at 1.2 line-height → ~87px is the most that fits, not the 400 claimed.
  const size = clampExtractedFontSize(400, 100, 1, 1.2);
  assert.ok(size <= 90, `expected the estimate to be capped, got ${size}`);
});

test('more lines mean a smaller cap', () => {
  const one = clampExtractedFontSize(999, 120, 1, 1.2);
  const four = clampExtractedFontSize(999, 120, 4, 1.2);
  assert.ok(four < one, 'four lines must fit in the same height as one');
  assert.ok(four >= MIN_TEXT_LAYER_FONT_PX);
});

test('a sensible estimate is kept as-is', () => {
  // Deliberately not "always shrink": a good estimate should survive untouched.
  assert.equal(clampExtractedFontSize(40, 400, 1, 1.2), 40);
});

test('a missing or nonsensical estimate falls back to the geometry', () => {
  assert.ok(clampExtractedFontSize(Number.NaN, 100, 1, 1.2) > MIN_TEXT_LAYER_FONT_PX);
  assert.ok(clampExtractedFontSize(-5, 100, 1, 1.2) > MIN_TEXT_LAYER_FONT_PX);
  assert.ok(clampExtractedFontSize(1e9, 10_000, 1, 1.2) <= MAX_TEXT_LAYER_FONT_PX);
});

// ── colour ─────────────────────────────────────────────────────────────────

test('colours are normalised to #rrggbb, with a fallback for anything unusable', () => {
  assert.equal(normalizeExtractedColor('#FFF', '#000000'), '#ffffff');
  assert.equal(normalizeExtractedColor('rgb(12, 212, 172)', '#000000'), '#0cd4ac');
  assert.equal(normalizeExtractedColor('近似白色', '#f8fafc'), '#f8fafc');
});

// ── region geometry ────────────────────────────────────────────────────────

test('regions map onto the canvas and never fall outside it', () => {
  assert.deepEqual(regionToPixels({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }), {
    left: 0, top: 0, width: 1920, height: 1080,
  });
  const clamped = regionToPixels({ xPct: 90, yPct: 90, widthPct: 100, heightPct: 100 });
  assert.equal(clamped.left + clamped.width, 1920);
  assert.equal(clamped.top + clamped.height, 1080);
});

test('the mask is transparent exactly where the text should be repainted', async () => {
  const mask = await buildRegionMask({ xPct: 25, yPct: 25, widthPct: 50, heightPct: 50 }, 1536, 1024);
  const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x: number, y: number): number => data[(y * info.width + x) * info.channels + 3] ?? 0;
  assert.equal(alphaAt(768, 512), 0, 'the middle of the region must be transparent (repaint here)');
  assert.equal(alphaAt(10, 10), 255, 'outside the region must stay opaque (leave it alone)');
});

// ── prompt ─────────────────────────────────────────────────────────────────

test('the recognition prompt carries the crop and its real pixel size', () => {
  // Without the size the model has no scale to estimate a font size against.
  const messages = buildExtractTextMessages('data:image/png;base64,AAA', 640, 120);
  const user = JSON.stringify(messages[1]?.content);
  assert.match(user, /640×120/);
  assert.match(user, /data:image\/png;base64,AAA/);
  assert.match(String(messages[0]?.content), /fontSizePx/);
});

// ── layer validation and CSS ───────────────────────────────────────────────

test('text layers survive validation intact when they are well formed', () => {
  assert.deepEqual(sanitizeTextLayers([layer()]), [layer()]);
});

test('layers that could break out of their declaration are dropped', () => {
  const layers = sanitizeTextLayers([
    layer({ id: 'bad1', color: 'red; position: fixed' }),
    layer({ id: 'bad2', fontSizePx: 5000 }),
    layer({ id: 'bad3', fontFamily: 'Comic Sans' as never }),
    layer({ id: 'bad4', text: '   ' }),
    layer({ id: 'good' }),
  ]);
  assert.deepEqual(layers.map((l) => l.id), ['good']);
});

test('layer CSS positions by percentage and uses a theme font, not a literal family', () => {
  const css = textLayerCss(layer());
  assert.match(css, /left: 10%/);
  assert.match(css, /font-size: 48px/);
  assert.match(css, /font-family: var\(--slide-font-heading\)/);
  // pre-wrap keeps the line breaks the original had; without it multi-line text collapses.
  assert.match(css, /white-space: pre-wrap/);
});

// ── erasing only inside the box ────────────────────────────────────────────

test('the erase context contains the box, has the model aspect ratio, and stays inside the image', () => {
  // The page is 16:9 and the model returns 3:2. Fitting the page into that letterboxes it (80px
  // bars at 1536x1024) while the mask was scaled uniformly — so the hole was never where the user
  // drew it. Working on a crop that already has the model's ratio removes the mismatch.
  const aspect = 1536 / 1024;
  const cases = [
    { left: 100, top: 100, width: 400, height: 120 },
    { left: 0, top: 0, width: 200, height: 80 },            // hard against a corner
    { left: 1700, top: 980, width: 200, height: 100 },       // hard against the far corner
    { left: 0, top: 0, width: 1920, height: 1080 },          // the whole page
  ];
  for (const box of cases) {
    const ctx = computeEraseContext(box, 1920, 1080, aspect);
    const label = JSON.stringify(box);
    assert.ok(ctx.left >= 0 && ctx.top >= 0, label);
    assert.ok(ctx.left + ctx.width <= 1920, label);
    assert.ok(ctx.top + ctx.height <= 1080, label);
    assert.ok(ctx.left <= box.left && ctx.top <= box.top, `${label} must contain the box`);
    assert.ok(ctx.left + ctx.width >= box.left + box.width, `${label} must contain the box`);
    assert.ok(ctx.top + ctx.height >= box.top + box.height, `${label} must contain the box`);
  }
});

test('erasing changes the pixels inside the box and nothing outside it', async () => {
  // The model repaints its whole input, so the guarantee cannot be "we asked it not to". Feeding a
  // solid-red "edit" makes any leakage obvious: every pixel outside the box must still be white.
  const original = await sharp({
    create: { width: 1920, height: 1080, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).png().toBuffer();
  const box = { left: 200, top: 300, width: 400, height: 200 };
  const context = computeEraseContext(box, 1920, 1080, 1536 / 1024);
  const edited = await sharp({
    create: { width: 1536, height: 1024, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer();

  const out = await compositeErasedRegion({ original, edited, context, box });
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  // Inside: repainted.
  assert.deepEqual(at(box.left + 5, box.top + 5), [255, 0, 0]);
  assert.deepEqual(at(box.left + box.width - 2, box.top + box.height - 2), [255, 0, 0]);
  // Just outside each edge, and in the padding the model also saw: untouched.
  assert.deepEqual(at(box.left - 2, box.top + 5), [255, 255, 255]);
  assert.deepEqual(at(box.left + box.width + 2, box.top + 5), [255, 255, 255]);
  assert.deepEqual(at(box.left + 5, box.top - 2), [255, 255, 255]);
  assert.deepEqual(at(box.left + 5, box.top + box.height + 2), [255, 255, 255]);
  assert.deepEqual(at(context.left + 2, context.top + 2), [255, 255, 255], 'the padding must not be written back');
  assert.deepEqual(at(1900, 1060), [255, 255, 255], 'the far corner must be untouched');
});

test('the mask hole is placed relative to the crop, not the page', async () => {
  // A hole computed against page coordinates lands somewhere else entirely once the model is
  // looking at a crop — which is how erasing one line took the whole slide's text with it.
  const box = { left: 200, top: 300, width: 400, height: 200 };
  const context = computeEraseContext(box, 1920, 1080, 1536 / 1024);
  const mask = await buildRegionMask(
    {
      xPct: ((box.left - context.left) / context.width) * 100,
      yPct: ((box.top - context.top) / context.height) * 100,
      widthPct: (box.width / context.width) * 100,
      heightPct: (box.height / context.height) * 100,
    },
    1536,
    1024,
  );
  const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
  const holeX = Math.round(((box.left - context.left) / context.width) * 1536);
  const holeY = Math.round(((box.top - context.top) / context.height) * 1024);
  assert.equal(alphaAt(holeX + 5, holeY + 5), 0, 'inside the hole must be transparent');
  assert.equal(alphaAt(Math.max(0, holeX - 5), Math.max(0, holeY - 5)), 255, 'outside must stay opaque');
});

test('the font size keeps the original line breaks, sized by the longest line', () => {
  // Both cases are real text lifted from a slide. The size must let each line stand as one line:
  // the breaks are where the original broke, and keeping them is most of what makes the result
  // look like the picture it came from.
  const a = '現實資料常有誤差或不完美，\n方程組不一定剛好有解。';
  assert.equal(clampExtractedFontSize(30, 109, 2, 1.4, a, 396), 24);
  const b = '改問：哪一個解最接近所有條件？\n這就是「近似解」的想法。';
  assert.equal(clampExtractedFontSize(36, 105, 2, 1.2, b, 447), 23);
  // Without the text and width the old behaviour is unchanged, so existing callers keep working.
  assert.equal(clampExtractedFontSize(30, 109, 2, 1.4), 30);
});

test('the longest line decides the size, not the average or the total', () => {
  // One long line among short ones has to bring the whole block down: it is the line that would
  // otherwise wrap, and a wrapped line is a different-looking block.
  const short = 'ab\nab\nab';
  const withLongLine = 'ab\nabcdefghijklmnop\nab';
  const box = { w: 200, h: 300, lh: 1.2 };
  assert.ok(
    fitFontSizeToBox(withLongLine, box.w, box.h, box.lh) < fitFontSizeToBox(short, box.w, box.h, box.lh),
  );
});

test('a fitted block stays inside its box on both axes', () => {
  const cases: Array<[string, number, number, number]> = [
    ['現實資料常有誤差或不完美，\n方程組不一定剛好有解。', 396, 109, 1.4],
    ['A short line', 400, 60, 1.2],
    ['一二三四五六七八九十', 120, 400, 1.2],
    ['Lorem ipsum dolor\nsit amet consectetur', 500, 90, 1.3],
  ];
  for (const [text, w, h, lh] of cases) {
    const size = fitFontSizeToBox(text, w, h, lh);
    const lines = text.split('\n');
    assert.ok(lines.length * size * lh <= h, `${text.slice(0, 12)}… is too tall at ${size}px`);
    for (const line of lines) {
      let em = 0;
      for (const ch of line) {
        em += ch === ' ' ? 0.35
          : /[\u2E80-\uA4CF\uAC00-\uD7FF\uF900-\uFAFF\uFF00-\uFF60]/.test(ch) ? 1.25
          : 0.62;
      }
      assert.ok(em * size <= w, `"${line.slice(0, 12)}…" is too wide at ${size}px`);
    }
    assert.ok(size >= MIN_TEXT_LAYER_FONT_PX);
  }
});
