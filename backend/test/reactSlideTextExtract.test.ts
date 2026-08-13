import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  buildExtractTextMessages,
  buildRegionMask,
  clampExtractedFontSize,
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
