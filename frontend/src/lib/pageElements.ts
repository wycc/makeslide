/**
 * Page element layer — pure types and rules shared by the display layer, the editor overlay and
 * the properties panel (docs/page-elements.md). Mirrors backend/src/services/pageElements.ts;
 * the backend schema is the authority and rejects anything outside these rules.
 */

/** Reference height that "reference pixel" sizes (font size, stroke width, padding) relate to. */
export const ELEMENT_REF_HEIGHT = 1080;
export const MAX_PAGE_ELEMENTS = 100;
export const MAX_ELEMENT_TEXT_CHARS = 2000;
export const MAX_ELEMENT_ASSET_BYTES = 8 * 1024 * 1024;

export const ELEMENT_FONT_FAMILIES = ['sans', 'serif', 'mono', 'kai'] as const;
export type ElementFontFamily = (typeof ELEMENT_FONT_FAMILIES)[number];
export const ELEMENT_SHAPES = ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'line', 'arrow'] as const;
export type ElementShape = (typeof ELEMENT_SHAPES)[number];

/** Browser-side font stacks per font key (the server has its own in pageElementsRender.ts). */
export const ELEMENT_FONT_STACKS: Record<ElementFontFamily, string> = {
  sans: '"Noto Sans CJK TC", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Helvetica Neue", Arial, sans-serif',
  serif: '"Noto Serif CJK TC", "Noto Serif TC", "Songti TC", PMingLiU, Georgia, serif',
  mono: '"Noto Sans Mono CJK TC", Menlo, Consolas, "Courier New", monospace',
  kai: '"AR PL UKai TW", BiauKai, DFKai-SB, "Noto Serif CJK TC", serif',
};

export interface PageElementBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
}

export interface TextElement extends PageElementBase {
  type: 'text';
  text: string;
  fontFamily: ElementFontFamily;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  color: string;
  background: string | null;
  padding: number;
  borderRadius: number;
}

export interface ImageElement extends PageElementBase {
  type: 'image';
  asset: string;
  fit: 'contain' | 'cover' | 'fill';
  borderRadius: number;
}

export interface ShapeElement extends PageElementBase {
  type: 'shape';
  shape: ElementShape;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  borderRadius: number;
}

export type PageElement = TextElement | ImageElement | ShapeElement;

// ─── Ids ────────────────────────────────────────────────────────────────────

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function newElementId(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
  return out;
}

// ─── Factories ──────────────────────────────────────────────────────────────

/** Where a new element lands: centred, so it is visible whatever the picture looks like. */
function centred(w: number, h: number): Pick<PageElementBase, 'x' | 'y' | 'w' | 'h'> {
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

export function newTextElement(text: string, overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: newElementId(),
    type: 'text',
    ...centred(0.5, 0.14),
    rotation: 0,
    opacity: 1,
    text,
    fontFamily: 'sans',
    fontSize: 48,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    valign: 'top',
    lineHeight: 1.3,
    color: '#111111',
    background: null,
    padding: 8,
    borderRadius: 0,
    ...overrides,
  };
}

/**
 * A pasted / uploaded picture: 40% of the page wide, height from its own aspect ratio (in page
 * units, so the page's aspect ratio is needed too), centred, never taller than 80% of the page.
 */
export function newImageElement(
  asset: string,
  image: { width: number; height: number },
  page: { width: number; height: number } = { width: 16, height: 9 },
  overrides: Partial<ImageElement> = {},
): ImageElement {
  const pageAspect = page.width / page.height;
  const imageAspect = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
  let w = 0.4;
  let h = (w * pageAspect) / imageAspect;
  if (h > 0.8) {
    h = 0.8;
    w = (h * imageAspect) / pageAspect;
  }
  return {
    id: newElementId(),
    type: 'image',
    ...centred(w, h),
    rotation: 0,
    opacity: 1,
    asset,
    fit: 'contain',
    borderRadius: 0,
    ...overrides,
  };
}

export function newShapeElement(shape: ElementShape, overrides: Partial<ShapeElement> = {}): ShapeElement {
  const isLine = shape === 'line' || shape === 'arrow';
  return {
    id: newElementId(),
    type: 'shape',
    ...(isLine ? centred(0.4, 0.06) : centred(0.25, 0.25)),
    rotation: 0,
    opacity: 1,
    shape,
    fill: isLine ? null : '#3b82f6',
    stroke: isLine ? '#111111' : null,
    strokeWidth: isLine ? 6 : 4,
    borderRadius: 0,
    ...overrides,
  };
}

/** A copy placed slightly down-right, the way every slide app offsets a duplicate. */
export function duplicateElement(el: PageElement): PageElement {
  return { ...el, id: newElementId(), x: Math.min(el.x + 0.03, 1 - el.w), y: Math.min(el.y + 0.03, 1 - el.h) };
}

// ─── Colours ────────────────────────────────────────────────────────────────

export const ELEMENT_COLOR_RE =
  /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d{1,4})\s*\))$/;

export function isElementColor(value: string): boolean {
  const m = ELEMENT_COLOR_RE.exec(value);
  if (!m) return false;
  if (m[3] !== undefined) return [m[3], m[4], m[5]].every((c) => Number(c) <= 255);
  return true;
}

/** Splits a stored colour into what the colour input (hex6) and the alpha slider (0..1) show. */
export function splitColor(value: string | null): { hex: string; alpha: number } {
  if (!value) return { hex: '#000000', alpha: 1 };
  const m = ELEMENT_COLOR_RE.exec(value);
  if (!m) return { hex: '#000000', alpha: 1 };
  if (m[3] !== undefined) {
    const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    return { hex: `#${toHex(m[3])}${toHex(m[4]!)}${toHex(m[5]!)}`, alpha: Number(m[6]) };
  }
  const hex = value.slice(0, 7).toLowerCase();
  const alpha = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return { hex, alpha: Math.round(alpha * 1000) / 1000 };
}

/** Joins colour + alpha back into the stored form: hex6 when opaque, hex8 otherwise. */
export function joinColor(hex: string, alpha: number): string {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : '#000000';
  const a = Math.max(0, Math.min(1, alpha));
  if (a >= 1) return clean;
  return `${clean}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
}

// ─── Geometry ───────────────────────────────────────────────────────────────

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export interface ElementBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_ELEMENT_SIZE = 0.01;

/** Moves a box by a delta in page units, keeping at least a sliver on the page. */
export function moveBox(box: ElementBox, dx: number, dy: number): ElementBox {
  const margin = 0.02;
  return {
    ...box,
    x: Math.max(-box.w + margin, Math.min(1 - margin, box.x + dx)),
    y: Math.max(-box.h + margin, Math.min(1 - margin, box.y + dy)),
  };
}

/**
 * Resizes a box by dragging one handle by (dx, dy) in page units. Corner handles keep the aspect
 * ratio when `keepAspect` is set (Shift). The opposite edge stays put, as in every slide editor.
 */
export function resizeBox(box: ElementBox, handle: ResizeHandle, dx: number, dy: number, keepAspect = false): ElementBox {
  let { x, y, w, h } = box;
  const right = x + w;
  const bottom = y + h;
  if (handle.includes('e')) w = Math.max(MIN_ELEMENT_SIZE, w + dx);
  if (handle.includes('s')) h = Math.max(MIN_ELEMENT_SIZE, h + dy);
  if (handle.includes('w')) {
    w = Math.max(MIN_ELEMENT_SIZE, w - dx);
    x = right - w;
  }
  if (handle.includes('n')) {
    h = Math.max(MIN_ELEMENT_SIZE, h - dy);
    y = bottom - h;
  }
  if (keepAspect && handle.length === 2 && box.w > 0 && box.h > 0) {
    const aspect = box.w / box.h;
    // Follow whichever axis moved more, derive the other.
    if (Math.abs(dx) >= Math.abs(dy)) h = Math.max(MIN_ELEMENT_SIZE, w / aspect);
    else w = Math.max(MIN_ELEMENT_SIZE, h * aspect);
    if (handle.includes('w')) x = right - w;
    if (handle.includes('n')) y = bottom - h;
  }
  return { x, y, w, h };
}

/** Angle (degrees, 0 = pointing up) of a pointer position around a box centre, in page pixels. */
export function rotationFromPointer(centre: { x: number; y: number }, pointer: { x: number; y: number }, snap = false): number {
  const deg = (Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * 180) / Math.PI + 90;
  let normalized = ((deg % 360) + 360) % 360;
  if (normalized > 180) normalized -= 360;
  if (snap) normalized = Math.round(normalized / 15) * 15;
  return Math.round(normalized * 10) / 10;
}

/** Keyboard nudge in page units: 1 reference px, ×10 with Shift, on a 1920×1080 reference. */
export function nudgeDelta(key: string, shift: boolean): { dx: number; dy: number } | null {
  const step = shift ? 10 : 1;
  const px = step / 1920;
  const py = step / ELEMENT_REF_HEIGHT;
  switch (key) {
    case 'ArrowLeft':
      return { dx: -px, dy: 0 };
    case 'ArrowRight':
      return { dx: px, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -py };
    case 'ArrowDown':
      return { dx: 0, dy: py };
    default:
      return null;
  }
}

/** Z-order moves; the array order is the stacking order (last on top). */
export function reorderElement(elements: PageElement[], id: string, move: 'up' | 'down' | 'top' | 'bottom'): PageElement[] {
  const idx = elements.findIndex((e) => e.id === id);
  if (idx < 0) return elements;
  const next = elements.slice();
  const [el] = next.splice(idx, 1);
  if (!el) return elements;
  let target = idx;
  if (move === 'up') target = Math.min(next.length, idx + 1);
  else if (move === 'down') target = Math.max(0, idx - 1);
  else if (move === 'top') target = next.length;
  else target = 0;
  next.splice(target, 0, el);
  return next;
}

// ─── Page-level rules ───────────────────────────────────────────────────────

export type PasteTarget = 'element' | 'base' | 'ignore';

/**
 * What a pasted / dropped picture becomes on a page of the given type: an element on image pages,
 * the background on React pages (their existing behaviour), nothing on notebook pages.
 */
export function pasteTargetForPage(renderType: string | null | undefined): PasteTarget {
  if (renderType === 'notebook') return 'ignore';
  if (renderType === 'react') return 'base';
  return 'element';
}

export function pageSupportsElements(renderType: string | null | undefined): boolean {
  return renderType !== 'react' && renderType !== 'notebook';
}

/**
 * Which picture the <img> shows: the base image when elements are drawn on top by the layer,
 * otherwise the (composite) page image — showing the composite under the layer would draw every
 * element twice.
 */
export function slideImageUrlForPage(
  page: { image_url?: string | null; thumbnail_url?: string | null; base_image_url?: string | null; elements?: unknown[] | null },
  hasDraftElements = false,
  preferThumbnail = false,
): string | null {
  const layered = hasDraftElements || (Array.isArray(page.elements) && page.elements.length > 0);
  // There is no thumbnail of the base image, and the composite's thumbnail already has the
  // elements painted in — so a layered page always shows the full-size base.
  if (layered && page.base_image_url) return page.base_image_url;
  if (preferThumbnail) return page.thumbnail_url ?? page.image_url ?? null;
  return page.image_url ?? page.thumbnail_url ?? null;
}

/** Points of the closed polygon shapes in a w×h box, as the SVG `points` attribute. */
export function shapePolygonPoints(shape: 'triangle' | 'diamond' | 'star', w: number, h: number): string {
  let pts: Array<[number, number]>;
  if (shape === 'triangle') pts = [[w / 2, 0], [w, h], [0, h]];
  else if (shape === 'diamond') pts = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
  else {
    pts = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 1 : 0.4;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push([w / 2 + Math.cos(angle) * (w / 2) * r, h / 2 + Math.sin(angle) * (h / 2) * r]);
    }
  }
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}
