import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { contrastRatio, relativeLuminance, parseRgbTriple, type Rgb } from './contrastRatio';

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

test('relativeLuminance of black is 0 and white is 1', () => {
  assert.equal(relativeLuminance(BLACK), 0);
  assert.ok(Math.abs(relativeLuminance(WHITE) - 1) < 1e-9);
});

test('contrastRatio black/white is 21 and is order-independent', () => {
  assert.ok(Math.abs(contrastRatio(BLACK, WHITE) - 21) < 1e-6);
  assert.equal(contrastRatio(BLACK, WHITE), contrastRatio(WHITE, BLACK));
});

test('contrastRatio of a colour with itself is 1', () => {
  assert.ok(Math.abs(contrastRatio(WHITE, WHITE) - 1) < 1e-9);
  assert.ok(Math.abs(contrastRatio([100, 116, 139], [100, 116, 139]) - 1) < 1e-9);
});

test('parseRgbTriple reads space-separated triples and tolerates noise', () => {
  assert.deepEqual(parseRgbTriple('71 85 105'), [71, 85, 105]);
  assert.deepEqual(parseRgbTriple('  14   116  144 ; /* cyan-700 */'), [14, 116, 144]);
  assert.equal(parseRgbTriple('not a colour'), null);
  assert.equal(parseRgbTriple('1 2'), null);
});

// --- 回歸測試：實際解析 index.css 的 light 主題 token 並驗證對比 ---

function extractBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `找不到 selector：${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  assert.ok(open !== -1 && close !== -1, `selector ${selector} 區塊不完整`);
  return css.slice(open + 1, close);
}

function readTokens(block: string): Record<string, Rgb> {
  const tokens: Record<string, Rgb> = {};
  for (const m of block.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)) {
    const name = m[1];
    const value = m[2];
    if (!name || !value) continue;
    const rgb = parseRgbTriple(value);
    if (rgb) tokens[name] = rgb;
  }
  return tokens;
}

const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');
const light = readTokens(extractBlock(css, ':root'));

/** 取出指定 token，缺少時讓測試失敗（同時為 TS 收斂出非 undefined 型別）。 */
function tok(name: string): Rgb {
  const rgb = light[name];
  assert.ok(rgb, `light 主題缺少 --color-${name}`);
  return rgb;
}

test('light theme foreground tokens are defined', () => {
  for (const key of ['bg', 'surface', 'text', 'muted', 'primary', 'danger', 'border']) {
    assert.ok(light[key], `light 主題缺少 --color-${key}`);
  }
});

test('light theme text meets WCAG AAA on both bg and surface', () => {
  assert.ok(contrastRatio(tok('text'), tok('bg')) >= 7, `text/bg 對比過低：${contrastRatio(tok('text'), tok('bg')).toFixed(2)}`);
  assert.ok(contrastRatio(tok('text'), tok('surface')) >= 7, `text/surface 對比過低：${contrastRatio(tok('text'), tok('surface')).toFixed(2)}`);
});

test('light theme muted text meets WCAG AA (4.5) on bg and surface', () => {
  for (const base of ['bg', 'surface']) {
    const ratio = contrastRatio(tok('muted'), tok(base));
    assert.ok(ratio >= 4.5, `muted/${base} 對比 ${ratio.toFixed(2)} < 4.5`);
  }
});

test('light theme primary and danger meet WCAG AA (4.5) on surface', () => {
  for (const key of ['primary', 'danger']) {
    const ratio = contrastRatio(tok(key), tok('surface'));
    assert.ok(ratio >= 4.5, `${key}/surface 對比 ${ratio.toFixed(2)} < 4.5`);
  }
});
