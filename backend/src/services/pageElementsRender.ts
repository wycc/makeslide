/**
 * Composes a page's base image and its element layer into one JPEG with node-canvas
 * (docs/page-elements.md §3.5). No browser, no user-supplied code: every input is a validated
 * `PageElement`, and the font families are a fixed whitelist.
 */
import { createCanvas, loadImage, type CanvasRenderingContext2D, type Image } from 'canvas';
import sharp from 'sharp';
import type { ElementFontFamily, PageElement, TextElement } from './pageElements';

const REF_HEIGHT = 1080;

/** Server-side font stacks per font key; the browser side has its own in frontend/src/lib/pageElements.ts. */
export const SERVER_FONT_STACKS: Record<ElementFontFamily, string> = {
  sans: '"Noto Sans CJK TC", "Noto Sans CJK JP", "Noto Sans TC", "Droid Sans Fallback", sans-serif',
  serif: '"Noto Serif CJK TC", "Noto Serif CJK JP", "AR PL UMing TW", serif',
  mono: '"Noto Sans Mono CJK TC", "Noto Sans Mono CJK JP", "DejaVu Sans Mono", monospace',
  kai: '"AR PL UKai TW", "AR PL UKai CN", "AR PL UMing TW", "Noto Serif CJK TC", serif',
};

export type AssetResolver = (assetName: string) => string | null;

export async function renderPageElements(basePath: string, elements: PageElement[], resolveAsset: AssetResolver): Promise<Buffer> {
  const base = await loadImage(basePath);
  const width = base.naturalWidth || base.width;
  const height = base.naturalHeight || base.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0, width, height);

  const scale = height / REF_HEIGHT;
  for (const el of elements) {
    const box = {
      x: el.x * width,
      y: el.y * height,
      w: Math.max(1, el.w * width),
      h: Math.max(1, el.h * height),
    };
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity));
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.translate(-box.w / 2, -box.h / 2);
    try {
      if (el.type === 'text') drawText(ctx, el, box.w, box.h, scale);
      else if (el.type === 'shape') drawShape(ctx, el, box.w, box.h, scale);
      else if (el.type === 'image') await drawImageElement(ctx, el, box.w, box.h, scale, resolveAsset);
    } finally {
      ctx.restore();
    }
  }

  const png = canvas.toBuffer('image/png');
  return sharp(png).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

// ─── Text ───────────────────────────────────────────────────────────────────

function fontString(el: TextElement, px: number): string {
  return `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${px}px ${SERVER_FONT_STACKS[el.fontFamily]}`;
}

/**
 * Greedy line wrap: CJK characters break anywhere, Latin runs break at spaces, and a run that
 * cannot fit on a line by itself is split character by character. Same rule the browser layer
 * approximates with `overflow-wrap: anywhere` + `word-break: normal`.
 */
export function wrapText(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const tokens = tokenize(paragraph);
    let line = '';
    for (const token of tokens) {
      const candidate = line + token;
      if (line === '' || measure(candidate) <= maxWidth) {
        if (line === '' && measure(token) > maxWidth && token.length > 1 && token.trim() !== '') {
          // The token alone overflows: split it by character.
          for (const ch of Array.from(token)) {
            if (line !== '' && measure(line + ch) > maxWidth) {
              lines.push(line);
              line = ch;
            } else {
              line += ch;
            }
          }
          continue;
        }
        line = candidate;
        continue;
      }
      lines.push(line.replace(/\s+$/, ''));
      line = token.trimStart();
      if (measure(line) > maxWidth && line.length > 1) {
        // Long token starting a fresh line — split it too.
        let acc = '';
        for (const ch of Array.from(line)) {
          if (acc !== '' && measure(acc + ch) > maxWidth) {
            lines.push(acc);
            acc = ch;
          } else {
            acc += ch;
          }
        }
        line = acc;
      }
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

function isCjk(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x20000 && code <= 0x3134f)
  );
}

/** Splits into wrap units: each CJK char on its own, Latin words with their trailing space. */
function tokenize(text: string): string[] {
  const out: string[] = [];
  let word = '';
  for (const ch of Array.from(text)) {
    if (isCjk(ch)) {
      if (word) {
        out.push(word);
        word = '';
      }
      out.push(ch);
    } else if (ch === ' ' || ch === '\t') {
      word += ch;
      out.push(word);
      word = '';
    } else {
      word += ch;
    }
  }
  if (word) out.push(word);
  return out;
}

function drawText(ctx: CanvasRenderingContext2D, el: TextElement, w: number, h: number, scale: number): void {
  const fontPx = Math.max(1, el.fontSize * scale);
  const padding = el.padding * scale;
  const radius = el.borderRadius * scale;
  if (el.background) {
    ctx.fillStyle = el.background;
    roundedRectPath(ctx, 0, 0, w, h, radius);
    ctx.fill();
  }
  ctx.font = fontString(el, fontPx);
  ctx.fillStyle = el.color;
  ctx.textBaseline = 'alphabetic';
  const innerW = Math.max(1, w - padding * 2);
  const innerH = Math.max(1, h - padding * 2);
  const lines = wrapText((s) => ctx.measureText(s).width, el.text, innerW);
  const lineH = fontPx * el.lineHeight;
  const blockH = lines.length * lineH;
  let yStart = padding;
  if (el.valign === 'middle') yStart = padding + (innerH - blockH) / 2;
  else if (el.valign === 'bottom') yStart = padding + innerH - blockH;
  // Baseline sits ~80% down the line box for typical CJK/Latin fonts; the browser layer uses the
  // same line-height model so the two agree to within a few pixels.
  const ascent = fontPx * 0.8 + (lineH - fontPx) / 2;

  ctx.save();
  roundedRectPath(ctx, 0, 0, w, h, radius);
  ctx.clip();
  lines.forEach((line, i) => {
    const textW = ctx.measureText(line).width;
    let x = padding;
    if (el.align === 'center') x = padding + (innerW - textW) / 2;
    else if (el.align === 'right') x = padding + innerW - textW;
    const y = yStart + i * lineH + ascent;
    ctx.fillText(line, x, y);
    if (el.underline && line.trim() !== '') {
      const thickness = Math.max(1, fontPx / 14);
      ctx.fillRect(x, y + thickness * 1.5, textW, thickness);
    }
  });
  ctx.restore();
}

// ─── Shapes ─────────────────────────────────────────────────────────────────

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (radius === 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** Polygon points for the closed shapes, in a w×h box; shared with the frontend SVG renderer. */
export function shapePolygon(shape: 'triangle' | 'diamond' | 'star', w: number, h: number): Array<[number, number]> {
  if (shape === 'triangle') return [[w / 2, 0], [w, h], [0, h]];
  if (shape === 'diamond') return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
  const points: Array<[number, number]> = [];
  const cx = w / 2;
  const cy = h / 2;
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.4;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push([cx + Math.cos(angle) * cx * r, cy + Math.sin(angle) * cy * r]);
  }
  return points;
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  el: Extract<PageElement, { type: 'shape' }>,
  w: number,
  h: number,
  scale: number,
): void {
  const strokeW = el.strokeWidth * scale;
  const fillAndStroke = () => {
    if (el.fill) {
      ctx.fillStyle = el.fill;
      ctx.fill();
    }
    if (el.stroke && strokeW > 0) {
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = strokeW;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  };

  switch (el.shape) {
    case 'rect':
      roundedRectPath(ctx, 0, 0, w, h, el.borderRadius * scale);
      fillAndStroke();
      return;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      fillAndStroke();
      return;
    case 'triangle':
    case 'diamond':
    case 'star': {
      const pts = shapePolygon(el.shape, w, h);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      fillAndStroke();
      return;
    }
    case 'line':
    case 'arrow': {
      // Lines run from the box's left-middle to right-middle; `rotation` gives the angle.
      const color = el.stroke ?? el.fill ?? '#111111';
      const lw = Math.max(1, strokeW || 4 * scale);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      const headLen = el.shape === 'arrow' ? Math.min(w / 2, lw * 4) : 0;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w - headLen, h / 2);
      ctx.stroke();
      if (el.shape === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(w, h / 2);
        ctx.lineTo(w - headLen, h / 2 - headLen * 0.6);
        ctx.lineTo(w - headLen, h / 2 + headLen * 0.6);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    default:
      return;
  }
}

// ─── Images ─────────────────────────────────────────────────────────────────

async function drawImageElement(
  ctx: CanvasRenderingContext2D,
  el: Extract<PageElement, { type: 'image' }>,
  w: number,
  h: number,
  scale: number,
  resolveAsset: AssetResolver,
): Promise<void> {
  const file = resolveAsset(el.asset);
  if (!file) return;
  let img: Image;
  try {
    img = await loadImage(file);
  } catch {
    // GIF/WebP node-canvas cannot decode natively: go through sharp to PNG first.
    const png = await sharp(file).png().toBuffer();
    img = await loadImage(png);
  }
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  let sx = 0;
  let sy = 0;
  let sw = iw;
  let sh = ih;
  let dx = 0;
  let dy = 0;
  let dw = w;
  let dh = h;
  if (el.fit === 'contain') {
    const r = Math.min(w / iw, h / ih);
    dw = iw * r;
    dh = ih * r;
    dx = (w - dw) / 2;
    dy = (h - dh) / 2;
  } else if (el.fit === 'cover') {
    const r = Math.max(w / iw, h / ih);
    sw = w / r;
    sh = h / r;
    sx = (iw - sw) / 2;
    sy = (ih - sh) / 2;
  }
  ctx.save();
  roundedRectPath(ctx, dx, dy, dw, dh, el.borderRadius * scale);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}
