/**
 * The composite has to be the same picture as the screen.
 *
 * Inline styles are built by string concatenation, and the font stacks name their fonts in quotes
 * (`"Noto Sans CJK TC", sans-serif`). Dropped raw into `style="…"`, that first quote ended the
 * attribute: `font-size`, `font-weight`, `text-align`, `line-height` and the vertical alignment
 * were all thrown away, so every baked text element came out at the browser's default 16px in the
 * browser's default font. On screen the same element was at the size the user chose — the page
 * looked right until it was baked, exported, or opened as a copy that had lost its element layer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageElementsDocument } from '../src/services/pageElementsDocument';
import type { PageElement } from '../src/services/pageElements';

const text = (over: Partial<PageElement> = {}): PageElement => ({
  id: 'e1', x: 0.1, y: 0.1, w: 0.5, h: 0.2, rotation: 0, opacity: 1,
  type: 'text', text: '# 標題\n* 條列', fontFamily: 'sans', fontSize: 48,
  bold: false, italic: false, underline: false, align: 'left', valign: 'top',
  lineHeight: 1.3, color: '#111111', background: null, padding: 8, borderRadius: 0,
  ...over,
} as PageElement);

/** The style attributes exactly as an HTML parser sees them: the value stops at the next quote. */
function styleAttributes(html: string): string[] {
  return [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]!);
}

test('a text element keeps its size and font once the attribute is parsed', () => {
  const html = buildPageElementsDocument({
    width: 1920, height: 1080, baseDataUrl: '', elements: [text()], assetDataUrls: {},
  });
  const withFont = styleAttributes(html).find((s) => s.includes('font-family'));
  assert.ok(withFont, 'the text element has an inline style');
  // Everything after font-family used to fall off the end of the attribute.
  assert.match(withFont, /font-size:48px/, '字級必須還在屬性裡面');
  assert.match(withFont, /font-weight:400/);
  assert.match(withFont, /text-align:left/);
  assert.match(withFont, /line-height:1\.3/);
  assert.match(withFont, /justify-content:flex-start/);
  // The font names survive as quotes the CSS parser will see, not as attribute terminators.
  assert.match(withFont, /font-family:&quot;Noto Sans CJK TC&quot;/);
  assert.ok(!/style="[^"]*font-family:"/.test(html), 'attribute 不可以被字型名稱的引號截斷');
});

test('the tag carries its style as one attribute and nothing else', () => {
  // A truncated attribute left `sans-serif;font-size:48px;…` sitting in the tag as junk
  // attributes. A tag that is exactly class + style is a tag that did not lose its tail.
  const html = buildPageElementsDocument({
    width: 1920, height: 1080, baseDataUrl: '', elements: [text({ fontFamily: 'mono' })], assetDataUrls: {},
  });
  const tag = /<div class="text ms-el-md"[^>]*>/.exec(html)?.[0];
  assert.ok(tag, 'the text element is there');
  assert.match(tag, /^<div class="text ms-el-md" style="[^"]*">$/, '標籤只該有 class 與 style 兩個屬性');
});

test('sizes still track the page: half-height page, half-size text', () => {
  const half = buildPageElementsDocument({
    width: 960, height: 540, baseDataUrl: '', elements: [text()], assetDataUrls: {},
  });
  const style = styleAttributes(half).find((s) => s.includes('font-family'))!;
  assert.match(style, /font-size:24px/);
  assert.match(style, /padding:4px/);
});
