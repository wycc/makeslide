/**
 * The HTML document headless Chrome renders to compose a page's element layer
 * (docs/page-elements.md §3): the base image plus every element laid out with the same CSS the
 * browser layer uses, text elements rendered as Markdown + KaTeX. `renderSlideToJpeg()` from the
 * React-slide bake screenshots it at the base image's size.
 *
 * Everything in here is a string literal or a validated `PageElement` field: colours match the
 * whitelist regex, numbers are numbers, text goes through the Markdown renderer's escaping.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { ELEMENT_REF_HEIGHT, type PageElement, type ElementFontFamily } from './pageElements';
import { containsMath, escapeHtml, renderMarkdownMathHtml } from './markdownMathHtml';
import { SERVER_FONT_STACKS, shapePolygon } from './pageElementsRender';

/**
 * Styles for Markdown inside a text element. The frontend has the identical block in
 * frontend/src/index.css (`.ms-el-md`); a test compares the two so the composite matches the screen.
 */
export const ELEMENT_MARKDOWN_CSS = `
.ms-el-md h3 { font-size: 1.5em; font-weight: 700; margin: 0.25em 0 0.1em; line-height: 1.2; }
.ms-el-md h4 { font-size: 1.25em; font-weight: 700; margin: 0.2em 0 0.1em; line-height: 1.2; }
.ms-el-md p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.ms-el-md ul { list-style: disc; padding-left: 1.4em; margin: 0; }
.ms-el-md ol { list-style: decimal; padding-left: 1.4em; margin: 0; }
.ms-el-md li { margin: 0; }
.ms-el-md code { font-family: "Noto Sans Mono CJK TC", Menlo, Consolas, monospace; font-size: 0.95em; background: rgba(0, 0, 0, 0.08); border-radius: 0.2em; padding: 0 0.25em; }
.ms-el-md a { color: inherit; text-decoration: underline; text-underline-offset: 0.12em; }
.ms-el-md table { border-collapse: collapse; width: 100%; text-align: left; }
.ms-el-md th, .ms-el-md td { border: 1px solid currentColor; padding: 0.1em 0.4em; vertical-align: top; }
.ms-el-md th { font-weight: 600; }
.ms-el-md .md > * + * { margin-top: 0.25em; }
.ms-el-md .katex-display { margin: 0.2em 0; }
.ms-el-md .katex { font-size: 1.05em; }
`;

const FONT_STACKS: Record<ElementFontFamily, string> = SERVER_FONT_STACKS;

let katexCssCache: string | null = null;

/** KaTeX's stylesheet with its woff2 fonts inlined — `setContent` has no base URL to load them from. */
export function katexCssWithInlineFonts(): string {
  if (katexCssCache !== null) return katexCssCache;
  const dist = path.join(config.repoRoot, 'node_modules', 'katex', 'dist');
  let css: string;
  try {
    css = fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf8');
  } catch {
    katexCssCache = '';
    return katexCssCache;
  }
  // Keep only the woff2 sources, inlined; drop the woff/ttf alternates so the file stays small.
  css = css.replace(/src:\s*url\(fonts\/([^)]+?\.woff2)\)\s*format\("woff2"\)[^;]*;/g, (_m, file: string) => {
    try {
      const data = fs.readFileSync(path.join(dist, 'fonts', file)).toString('base64');
      return `src:url(data:font/woff2;base64,${data}) format("woff2");`;
    } catch {
      return 'src:local("KaTeX");';
    }
  });
  katexCssCache = css;
  return katexCssCache;
}

export interface ElementsDocumentInput {
  width: number;
  height: number;
  baseDataUrl: string;
  elements: PageElement[];
  /** asset file name → data URL */
  assetDataUrls: Record<string, string>;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(4)}%`;
}

function elementHtml(el: PageElement, scale: number, assetDataUrls: Record<string, string>): string {
  if (el.type === 'line') return ''; // lines are drawn in one SVG over the page (see below)
  const box = [
    `left:${pct(el.x)}`,
    `top:${pct(el.y)}`,
    `width:${pct(el.w)}`,
    `height:${pct(el.h)}`,
    `opacity:${el.opacity}`,
    el.rotation ? `transform:rotate(${el.rotation}deg)` : '',
  ]
    .filter(Boolean)
    .join(';');
  if (el.type === 'text') {
    const justify = el.valign === 'middle' ? 'center' : el.valign === 'bottom' ? 'flex-end' : 'flex-start';
    const style = [
      `padding:${el.padding * scale}px`,
      el.background ? `background:${el.background}` : '',
      `border-radius:${el.borderRadius * scale}px`,
      `color:${el.color}`,
      `font-family:${FONT_STACKS[el.fontFamily]}`,
      `font-size:${el.fontSize * scale}px`,
      `font-weight:${el.bold ? 700 : 400}`,
      `font-style:${el.italic ? 'italic' : 'normal'}`,
      `text-decoration:${el.underline ? 'underline' : 'none'}`,
      `text-align:${el.align}`,
      `line-height:${el.lineHeight}`,
      `justify-content:${justify}`,
    ]
      .filter(Boolean)
      .join(';');
    return `<div class="el" style="${box}"><div class="text ms-el-md" style="${style}">${renderMarkdownMathHtml(el.text)}</div></div>`;
  }
  if (el.type === 'image') {
    const src = assetDataUrls[el.asset] ?? '';
    return `<div class="el" style="${box}"><img src="${escapeHtml(src)}" style="object-fit:${el.fit};border-radius:${el.borderRadius * scale}px" alt=""></div>`;
  }
  const W = 1000;
  const H = 1000;
  const common = `fill="${el.fill ?? 'none'}" stroke="${el.stroke ?? 'none'}" stroke-width="${el.strokeWidth * scale}" vector-effect="non-scaling-stroke" stroke-linejoin="round"`;
  let body = '';
  if (el.shape === 'rect') {
    const r = el.borderRadius * scale;
    body = `<rect x="0" y="0" width="${W}" height="${H}" rx="${r}" ry="${r}" ${common}/>`;
  } else if (el.shape === 'ellipse') {
    body = `<ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2}" ry="${H / 2}" ${common}/>`;
  } else {
    const points = shapePolygon(el.shape, W, H).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    body = `<polygon points="${points}" ${common}/>`;
  }
  return `<div class="el" style="${box}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${body}</svg></div>`;
}

function linesSvg(elements: PageElement[], width: number, height: number, scale: number): string {
  const lines = elements.filter((el): el is Extract<PageElement, { type: 'line' }> => el.type === 'line');
  if (lines.length === 0) return '';
  const parts = lines.map((el, i) => {
    const lw = Math.max(1, el.strokeWidth * scale);
    const id = `ah${i}`;
    const markers = [
      el.arrowEnd ? `<marker id="${id}e" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="${el.stroke}"/></marker>` : '',
      el.arrowStart ? `<marker id="${id}s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="${el.stroke}"/></marker>` : '',
    ].join('');
    const refs = `${el.arrowEnd ? ` marker-end="url(#${id}e)"` : ''}${el.arrowStart ? ` marker-start="url(#${id}s)"` : ''}`;
    return `<defs>${markers}</defs><line x1="${el.x1 * width}" y1="${el.y1 * height}" x2="${el.x2 * width}" y2="${el.y2 * height}" stroke="${el.stroke}" stroke-width="${lw}" stroke-linecap="round" opacity="${el.opacity}"${refs}/>`;
  });
  return `<svg class="lines" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

/**
 * Builds the document. Elements are stacked in array order; lines share one SVG placed at the
 * z-position of the first line so they still sit above earlier and below later elements only
 * approximately — lines are annotations, and that is the same simplification the screen makes.
 */
export function buildPageElementsDocument(input: ElementsDocumentInput): string {
  const { width, height, baseDataUrl, elements, assetDataUrls } = input;
  const scale = height / ELEMENT_REF_HEIGHT;
  const needsKatex = elements.some((el) => el.type === 'text' && containsMath(el.text));
  const body: string[] = [];
  let linesEmitted = false;
  for (const el of elements) {
    if (el.type === 'line') {
      if (!linesEmitted) {
        body.push(linesSvg(elements, width, height, scale));
        linesEmitted = true;
      }
      continue;
    }
    body.push(elementHtml(el, scale, assetDataUrls));
  }
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
html, body { margin: 0; padding: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #fff; }
#root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
#root > img.base { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
.el { position: absolute; transform-origin: center center; box-sizing: border-box; }
.el > .text { position: absolute; inset: 0; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; }
.el > img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.el > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; display: block; }
svg.lines { position: absolute; left: 0; top: 0; overflow: visible; }
${ELEMENT_MARKDOWN_CSS}
${needsKatex ? katexCssWithInlineFonts() : ''}
</style></head>
<body><div id="root"><img class="base" src="${escapeHtml(baseDataUrl)}" alt="">${body.join('')}</div>
<script>
(function () {
  var done = false;
  function ready() { if (!done) { done = true; window.__msSlideReady = true; } }
  function imagesSettled() {
    var imgs = Array.prototype.slice.call(document.images);
    return Promise.all(imgs.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) { img.addEventListener('load', resolve); img.addEventListener('error', resolve); });
    }));
  }
  var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.all([imagesSettled(), fonts]).then(ready, ready);
  setTimeout(ready, 8000);
})();
</script></body></html>`;
}
