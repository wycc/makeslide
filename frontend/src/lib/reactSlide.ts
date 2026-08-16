import type { CSSProperties } from 'react';

/**
 * React slide pages (`render_type = 'react'`) — client side of docs/react-slide-design.md.
 *
 * The page's compiled JS runs inside a sandboxed iframe (`allow-scripts` only, so it is an opaque
 * origin with no access to the app's DOM, cookies or session). This module builds that iframe's
 * document and owns the two things that cross the boundary in either direction: the per-element
 * overrides we send in, and the element selections the sandbox sends back.
 */

/** The canvas every generated slide is laid out against; the frame scales it, it never reflows. */
export const SLIDE_CANVAS_WIDTH = 1920;
export const SLIDE_CANVAS_HEIGHT = 1080;

export const SLIDE_THEME_TOKEN_KEYS = [
  '--slide-bg',
  '--slide-surface',
  '--slide-fg',
  '--slide-fg-muted',
  '--slide-accent',
  '--slide-accent-fg',
  '--slide-border',
  '--slide-font-heading',
  '--slide-font-body',
  '--slide-font-mono',
  '--slide-heading-size',
  '--slide-body-size',
  '--slide-radius',
  '--slide-gap',
  '--slide-padding',
  '--slide-shadow',
] as const;

export type SlideThemeTokenKey = (typeof SLIDE_THEME_TOKEN_KEYS)[number];

/** Tokens rendered with a color picker in the theme editor; the rest get a text field. */
export const SLIDE_THEME_COLOR_TOKENS: ReadonlySet<string> = new Set([
  '--slide-bg',
  '--slide-surface',
  '--slide-fg',
  '--slide-fg-muted',
  '--slide-accent',
  '--slide-accent-fg',
  '--slide-border',
]);

export const DEFAULT_SLIDE_THEME_TOKENS: Record<SlideThemeTokenKey, string> = {
  '--slide-bg': '#0f172a',
  '--slide-surface': '#1e293b',
  '--slide-fg': '#f8fafc',
  '--slide-fg-muted': '#94a3b8',
  '--slide-accent': '#38bdf8',
  '--slide-accent-fg': '#0f172a',
  '--slide-border': '#334155',
  '--slide-font-heading': '"Noto Sans TC", system-ui, sans-serif',
  '--slide-font-body': '"Noto Sans TC", system-ui, sans-serif',
  '--slide-font-mono': 'ui-monospace, monospace',
  '--slide-heading-size': '88px',
  '--slide-body-size': '36px',
  '--slide-radius': '24px',
  '--slide-gap': '32px',
  '--slide-padding': '96px',
  '--slide-shadow': '0 24px 60px rgba(0,0,0,0.35)',
};

/** Mirrors the backend whitelist (services/reactSlide.ts); kept in sync by reactSlide.test.ts. */
export const EDITABLE_CSS_PROPERTIES = [
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-family',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-shadow',
  'opacity',
  'padding',
  'margin',
  'border-radius',
  'border-width',
  'border-style',
  'border-color',
  'box-shadow',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'display',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'transform',
  'z-index',
  // Placement, needed since text lifted off the background image became a real element in the
  // code: it is positioned on the canvas, so moving it is editing these four. This list had
  // drifted from the backend's, which meant a left/top override was dropped on the way out and
  // dragging an element would have looked like it did nothing.
  'position',
  'left',
  'top',
  'right',
  'bottom',
  'white-space',
  'overflow',
] as const;

export type EditableCssProperty = (typeof EDITABLE_CSS_PROPERTIES)[number];

const EDITABLE_CSS_PROPERTY_SET: ReadonlySet<string> = new Set(EDITABLE_CSS_PROPERTIES);

export const MAX_CSS_VALUE_LENGTH = 200;
export const MAX_OVERRIDE_TEXT_LENGTH = 2000;

const UNSAFE_CSS_VALUE = /url\s*\(|@import|expression\s*\(|javascript\s*:|<|\}|;/i;

export function isSafeCssValue(value: string): boolean {
  if (value.length === 0 || value.length > MAX_CSS_VALUE_LENGTH) return false;
  return !UNSAFE_CSS_VALUE.test(value);
}

export function isEditableCssProperty(property: string): boolean {
  return EDITABLE_CSS_PROPERTY_SET.has(property);
}

/** Drop anything the backend would reject, so the editor never shows a tweak that won't persist. */
export function normalizeStyleOverrides(styles: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!styles) return out;
  for (const [rawProp, rawValue] of Object.entries(styles)) {
    const property = String(rawProp).trim().toLowerCase();
    if (!isEditableCssProperty(property)) continue;
    if (typeof rawValue !== 'string') continue;
    const value = rawValue.trim();
    if (!isSafeCssValue(value)) continue;
    out[property] = value;
  }
  return out;
}

export interface SlideTheme {
  version: 1;
  name: string;
  tokens: Record<SlideThemeTokenKey, string>;
  customCss?: string;
  updated_at?: string;
}

export function defaultSlideTheme(): SlideTheme {
  return { version: 1, name: 'Default', tokens: { ...DEFAULT_SLIDE_THEME_TOKENS } };
}

export interface ReactSlideOverride {
  /** Restricted markup (text, <br>, coloured <span>) — what the rich text editor produces. */
  html?: string;
  text?: string;
  styles?: Record<string, string>;
  /** Element deleted from the slide. Mirrors the backend model (services/reactSlide.ts). */
  hidden?: boolean;
}

export const TEXT_LAYER_FONTS = ['heading', 'body', 'mono'] as const;
export type TextLayerFont = (typeof TEXT_LAYER_FONTS)[number];

export const MIN_TEXT_LAYER_FONT_PX = 8;
export const MAX_TEXT_LAYER_FONT_PX = 400;

/** Mirrors the backend model (services/reactSlide.ts); see docs/react-slide-image-to-text.md §3.3. */
export interface ReactSlideTextLayer {
  id: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  text: string;
  fontSizePx: number;
  color: string;
  fontWeight: number;
  fontFamily: TextLayerFont;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  extractedAt?: string;
}

/**
 * CSS for one text layer. Kept in one function because the sandbox and the server-side baker must
 * lay these out identically — a layer that sits differently in the export than on screen is worse
 * than one that is missing, because nobody notices until the file is already sent.
 */
export function textLayerCss(layer: ReactSlideTextLayer): string {
  return [
    'position: absolute',
    `left: ${layer.xPct}%`,
    `top: ${layer.yPct}%`,
    `width: ${layer.widthPct}%`,
    `height: ${layer.heightPct}%`,
    `font-size: ${layer.fontSizePx}px`,
    `line-height: ${layer.lineHeight}`,
    `font-weight: ${layer.fontWeight}`,
    `font-family: var(--slide-font-${layer.fontFamily})`,
    `color: ${layer.color}`,
    `text-align: ${layer.textAlign}`,
    'white-space: pre-wrap',
    'overflow: hidden',
  ].join('; ');
}

export interface ReactSlideBackground {
  mode: 'none' | 'color' | 'image';
  color?: string;
  prompt?: string;
  file?: string;
  fit?: 'cover' | 'contain';
  position?: string;
  overlayColor?: string;
  overlayOpacity?: number;
}

export interface ReactSlideConfig {
  version: 1;
  prompt?: string;
  overrides: Record<string, ReactSlideOverride>;
  background: ReactSlideBackground;
  /** Text lifted out of the background image; rendered above the component. */
  textLayers: ReactSlideTextLayer[];
  updated_at?: string;
}

export function defaultReactSlideConfig(): ReactSlideConfig {
  return { version: 1, overrides: {}, background: { mode: 'none' }, textLayers: [] };
}

/** Payload the sandbox posts up when the user clicks an element in inspect mode. */
export interface SlideElementSelection {
  /** The id written into the JSX source (data-ms-id); stable across edits and reformatting. */
  id: string;
  /** Content as restricted markup (text, <br>, coloured <span>), for rich editing. */
  html?: string;
  tagName: string;
  text: string;
  /** The element's own inline styles, as a starting point for editing. */
  styles: Record<string, string>;
  /** Computed values for the whitelisted properties, so the editor can show what is actually rendered. */
  computed: Record<string, string>;
  /** The element's link target, or '' — the panel edits this like any other property. */
  href?: string;
  /** Whether dragging moves this element: only absolutely positioned ones can be placed freely. */
  movable?: boolean;
  /** Where the layout currently puts it, in canvas px — the starting point for "place freely". */
  rect?: { left: number; top: number; width: number; height: number };
}

export type SlideSandboxMessage =
  | { type: 'ms-slide-ready' }
  | { type: 'ms-slide-delete-request' }
  | { type: 'ms-slide-select-layer'; layerId: string }
  | { type: 'ms-slide-error'; message: string }
  | { type: 'ms-slide-stats'; pathCount: number; lastClick?: string }
  /** A clickable element was clicked; the parent opens it, since the sandbox is not allowed to. */
  | { type: 'ms-slide-link'; href: string }
  /** An element was dragged (or nudged) to a new place; `left`/`top` carry their unit. */
  | { type: 'ms-slide-move'; id: string; left: string; top: string }
  | ({ type: 'ms-slide-select' } & SlideElementSelection);

/** What the sandbox reports about itself, surfaced in the inspector so faults are visible. */
export interface SlideSandboxStats {
  /** Elements carrying a `data-ms-id`; zero means nothing is selectable yet. */
  pathCount: number;
  /** Tag of the last element clicked, with `!` when it had no selectable ancestor. */
  lastClick?: string;
}

export function isSlideSandboxMessage(data: unknown): data is SlideSandboxMessage {
  if (!data || typeof data !== 'object') return false;
  const type = (data as { type?: unknown }).type;
  return (
    type === 'ms-slide-ready'
    || type === 'ms-slide-error'
    || type === 'ms-slide-select'
    || type === 'ms-slide-delete-request'
    || type === 'ms-slide-stats'
    || type === 'ms-slide-select-layer'
    || type === 'ms-slide-link'
    || type === 'ms-slide-move'
  );
}

/**
 * Whether the parent window will open this link.
 *
 * Checked here and not only in the sandbox: the slide's code can be hand-edited, so a
 * `data-ms-href` arriving over postMessage is untrusted input. Only http(s) — which is what keeps
 * `javascript:`, `data:` and `file:` from ever reaching `window.open`.
 */
export function isOpenableSlideLink(href: string): boolean {
  if (!href || href.length > 2000) return false;
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Scale that fits the 1920×1080 canvas into `containerWidth` px. */
export function slideScale(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 1;
  return containerWidth / SLIDE_CANVAS_WIDTH;
}

/**
 * Scale that fits the whole 1920×1080 canvas inside a box, by whichever axis runs out first.
 *
 * Width alone overflows the moment the box is shorter than 16:9; height alone wastes the width.
 */
export function slideFitScale(containerWidth: number, containerHeight: number): number {
  const byWidth = slideScale(containerWidth);
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) return byWidth;
  return Math.min(byWidth, containerHeight / SLIDE_CANVAS_HEIGHT);
}

/**
 * The frame's own box: 16:9, as wide as it is allowed to be, and **never taller than the space it
 * was given**.
 *
 * That last part is the whole point. `width: 100%` plus an aspect ratio derives the height from the
 * width and never looks at the available height, so on any screen whose slide area is shorter than
 * 16:9 — which is every 16:9 display once a toolbar is subtracted — the box grew past the viewport
 * and the slide was cropped on all four sides. An image page never had this: `object-contain` fits
 * to both axes by itself.
 *
 * With the cap, the box stops at the space it was given and `slideFitScale` has a real height to
 * measure. Where no ancestor has a definite height the percentage does not resolve, which leaves
 * the previous behaviour rather than collapsing the box to nothing.
 */
export function slideFrameBoxStyle(maxHeight?: string | number): CSSProperties {
  return {
    position: 'relative',
    width: '100%',
    aspectRatio: `${SLIDE_CANVAS_WIDTH} / ${SLIDE_CANVAS_HEIGHT}`,
    maxHeight: maxHeight ?? '100%',
    overflow: 'hidden',
  };
}

/** Element path assigned by the sandbox: element-child indices from the slide root, e.g. `0/2/1`. */
export function isValidElementPath(path: string): boolean {
  return /^\d+(\/\d+)*$/.test(path) && path.length <= 200;
}

/**
 * The properties the inspector offers as direct controls, in the order they appear. Everything
 * else stays behind the "any property" picker: these are the ones people actually reach for, and
 * a panel that lists all 31 at once is a panel nobody reads.
 */
export const QUICK_CSS_PROPERTIES = [
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'text-align',
  'padding',
  'border-radius',
  'opacity',
] as const;

/** Values offered for properties whose useful values are a short fixed list. */
export const CSS_PROPERTY_CHOICES: Partial<Record<EditableCssProperty, readonly string[]>> = {
  'font-weight': ['300', '400', '500', '600', '700', '800', '900'],
  'text-align': ['left', 'center', 'right', 'justify'],
  'font-style': ['normal', 'italic'],
  'text-transform': ['none', 'uppercase', 'lowercase', 'capitalize'],
  'border-style': ['solid', 'dashed', 'dotted', 'none'],
  display: ['block', 'inline-block', 'flex', 'grid', 'none'],
  'flex-direction': ['row', 'column'],
  'justify-content': ['flex-start', 'center', 'flex-end', 'space-between', 'space-around'],
  'align-items': ['flex-start', 'center', 'flex-end', 'stretch'],
};

/**
 * Convert a computed CSS color to the `#rrggbb` an `<input type="color">` needs.
 *
 * Computed styles come back as `rgb(15, 23, 42)` / `rgba(…)`, which a color input rejects
 * outright (it silently shows black), so the swatch would never reflect the element's actual
 * color. Returns null for anything not resolvable — `transparent`, gradients, `currentColor` —
 * so callers can fall back rather than show a misleading swatch.
 */
export function cssColorToHex(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/i.exec(trimmed);
  if (!rgb) return null;
  // A fully transparent colour has no meaningful swatch — computed styles report unset
  // backgrounds as `rgba(0, 0, 0, 0)`, and showing that as black reads as "this is black".
  if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null;
  const channel = (raw: string | undefined): string => {
    const n = Math.max(0, Math.min(255, Math.round(Number(raw))));
    return Number.isFinite(n) ? n.toString(16).padStart(2, '0') : '00';
  };
  return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`;
}

/** Numeric part of a `12px` / `1.5rem` style value, or null when it isn't a single length. */
export function parseLengthValue(value: string | undefined): { number: number; unit: string } | null {
  if (!value) return null;
  const match = /^(-?[\d.]+)\s*(px|rem|em|%|vw|vh)?$/.exec(value.trim());
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  return { number, unit: match[2] ?? '' };
}

/**
 * Apply one property edit to an override, returning the new override (or null when the override
 * has nothing left in it, so callers can drop the entry instead of storing an empty object).
 *
 * An empty value removes the property rather than storing `""`: "clear this tweak" and "set this
 * to the empty string" are different intents, and only the first one is reachable from a text
 * field the user has just emptied.
 */
export function withStyleOverride(
  override: ReactSlideOverride | undefined,
  property: string,
  value: string,
): ReactSlideOverride | null {
  const styles = { ...(override?.styles ?? {}) };
  const trimmed = value.trim();
  if (trimmed === '') delete styles[property];
  else styles[property] = trimmed;
  const next: ReactSlideOverride = {
    ...(override?.text !== undefined ? { text: override.text } : {}),
    ...(Object.keys(styles).length > 0 ? { styles } : {}),
    ...(override?.hidden ? { hidden: true } : {}),
  };
  return isEmptyOverride(next) ? null : next;
}

/** Same contract as `withStyleOverride`, for the element's text. */
export function withTextOverride(
  override: ReactSlideOverride | undefined,
  text: string | undefined,
): ReactSlideOverride | null {
  const next: ReactSlideOverride = {
    ...(text !== undefined ? { text } : {}),
    ...(override?.styles && Object.keys(override.styles).length > 0 ? { styles: override.styles } : {}),
    ...(override?.hidden ? { hidden: true } : {}),
  };
  return isEmptyOverride(next) ? null : next;
}

/**
 * Turn the pending edit buffer into the edits that get written into the JSX.
 *
 * The buffer is keyed by element id and shaped for live preview (text / styles / hidden); the
 * source rewriter takes one operation at a time. Deletion comes last for an element that is both
 * restyled and deleted — the rewriter ignores edits inside a deleted range, and this way the
 * intent reads the same in the request as it does in the panel.
 */
export type PendingSlideEdit =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'richText'; id: string; html: string }
  | { kind: 'style'; id: string; property: string; value: string }
  | { kind: 'delete'; id: string };

export function overridesToEdits(overrides: Record<string, ReactSlideOverride>): PendingSlideEdit[] {
  const edits: PendingSlideEdit[] = [];
  for (const [id, override] of Object.entries(overrides)) {
    if (override.hidden) {
      edits.push({ kind: 'delete', id });
      continue;
    }
    if (override.html !== undefined) edits.push({ kind: 'richText', id, html: override.html });
    else if (override.text !== undefined) edits.push({ kind: 'text', id, text: override.text });
    for (const [property, value] of Object.entries(override.styles ?? {})) {
      edits.push({ kind: 'style', id, property, value });
    }
  }
  return edits;
}

/** An override with nothing in it is stored as no override at all. */
function isEmptyOverride(override: ReactSlideOverride): boolean {
  return override.text === undefined && override.html === undefined
    && override.styles === undefined && !override.hidden;
}

/** Same contract as the other helpers, for the element's rich text content. */
export function withHtmlOverride(
  override: ReactSlideOverride | undefined,
  html: string | undefined,
): ReactSlideOverride | null {
  const next: ReactSlideOverride = {
    ...(html !== undefined ? { html } : {}),
    ...(override?.styles && Object.keys(override.styles).length > 0 ? { styles: override.styles } : {}),
    ...(override?.hidden ? { hidden: true } : {}),
  };
  return isEmptyOverride(next) ? null : next;
}

/**
 * Delete the element, or put it back.
 *
 * Same contract as the other two helpers, so "delete" is one more kind of tweak on the element
 * rather than a separate mechanism: it is listed, cleared and saved exactly like the rest, and
 * un-deleting an element that has no other tweaks drops the entry entirely.
 */
export function withHiddenOverride(
  override: ReactSlideOverride | undefined,
  hidden: boolean,
): ReactSlideOverride | null {
  const next: ReactSlideOverride = {
    ...(override?.text !== undefined ? { text: override.text } : {}),
    ...(override?.styles && Object.keys(override.styles).length > 0 ? { styles: override.styles } : {}),
    ...(hidden ? { hidden: true } : {}),
  };
  return isEmptyOverride(next) ? null : next;
}

export function backgroundStyle(config: ReactSlideConfig, backgroundUrl?: string): CSSProperties {
  const bg = config.background ?? { mode: 'none' };
  if (bg.mode === 'color' && bg.color && isSafeCssValue(bg.color)) {
    return { backgroundColor: bg.color };
  }
  if (bg.mode === 'image' && backgroundUrl) {
    // The URL is one of ours, but it still goes through encodeURI + a quote strip so a
    // pathological id can never break out of the url() and add declarations of its own.
    const safeUrl = encodeURI(backgroundUrl).replace(/["'()\\]/g, '');
    return {
      backgroundImage: `url("${safeUrl}")`,
      backgroundSize: bg.fit === 'contain' ? 'contain' : 'cover',
      backgroundPosition: bg.position && isSafeCssValue(bg.position) ? bg.position : 'center',
      backgroundRepeat: 'no-repeat',
    };
  }
  return {};
}

/** The scrim over a background image, which is what keeps foreground text readable. */
export function overlayStyle(config: ReactSlideConfig): CSSProperties {
  const bg = config.background ?? { mode: 'none' };
  if (bg.mode !== 'image') return { display: 'none' };
  const color = bg.overlayColor && isSafeCssValue(bg.overlayColor) ? bg.overlayColor : '#000000';
  const opacity = typeof bg.overlayOpacity === 'number' && bg.overlayOpacity >= 0 && bg.overlayOpacity <= 1
    ? bg.overlayOpacity
    : 0.45;
  return { backgroundColor: color, opacity };
}

/** Human-readable label for an override entry in the editor's list. */
export function describeOverride(path: string, override: ReactSlideOverride): string {
  const bits: string[] = [];
  if (override.hidden) bits.push('🗑');
  if (override.text !== undefined) bits.push(`"${override.text.slice(0, 20)}"`);
  const styleCount = Object.keys(override.styles ?? {}).length;
  if (styleCount > 0) bits.push(`${styleCount} CSS`);
  return `${path} — ${bits.join(' · ')}`;
}

/** Encodes a (possibly non-Latin1) string as base64, for safe embedding in a `<script>` block. */
function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * URL of a vendored asset, resolved against the document base so it keeps working when the app is
 * served from a sub-path. The sandbox's own base is `about:srcdoc`, so it can only use absolute
 * URLs — this is where they come from.
 */
export function vendorUrl(file: string): string {
  if (typeof document === 'undefined') return `/vendor/${file}`;
  return new URL(`vendor/${file}`, document.baseURI).href;
}

export interface SandboxDocInput {
  /** esbuild-compiled JS from the backend (assigns `window.SlideComponent`). */
  compiled: string;
  theme: SlideTheme;
  config: ReactSlideConfig;
  /** Absolute URL of the page's generated background image, when `background.mode === 'image'`. */
  backgroundUrl?: string;
  /**
   * `{ assetName: data-url }` for the page's images — what `MS_ASSET(name)` resolves against.
   *
   * The code stores an asset's *name*, never a URL, so it stays valid wherever the deck is served
   * from (docs/page-overlay-and-fusion.md §4.2). Data URLs rather than endpoint URLs for the same
   * reason the background is painted outside the sandbox: this document is an opaque origin, so a
   * request it makes is cross-site and carries no session cookie — the image would 403. The parent
   * fetches the bytes (with its session) and hands them over inline, exactly as baking does.
   */
  assetDataUrls?: Record<string, string>;
  /**
   * Whether click-to-select starts enabled. Baked into the document as well as pushed over
   * postMessage: if the frame finishes loading before the parent's message listener is attached,
   * the "inspect on" message is lost and clicking the slide would do nothing, silently.
   */
  inspect?: boolean;
}

function themeCss(theme: SlideTheme): string {
  const declarations = SLIDE_THEME_TOKEN_KEYS
    .map((key) => {
      const value = theme.tokens?.[key] ?? DEFAULT_SLIDE_THEME_TOKENS[key];
      return isSafeCssValue(value) ? `  ${key}: ${value};` : `  ${key}: ${DEFAULT_SLIDE_THEME_TOKENS[key]};`;
    })
    .join('\n');
  return `:root {\n${declarations}\n}`;
}

/**
 * Whether anything is painted behind the slide.
 *
 * `mode: 'color'` with no colour, or `'image'` before one has been generated, mean "nothing yet" —
 * treating those as a background would paint transparent over the theme's own page colour and
 * leave the slide sitting on whatever is underneath.
 */
export function hasSlideBackground(config: ReactSlideConfig, backgroundUrl?: string): boolean {
  const bg = config.background ?? { mode: 'none' };
  if (bg.mode === 'color') return Boolean(bg.color && isSafeCssValue(bg.color));
  if (bg.mode === 'image') return Boolean(backgroundUrl);
  return false;
}

/**
 * Declarations for the background layer, which the *frame* paints — not the sandbox.
 *
 * The background image is served from an authenticated endpoint on our own origin. Inside the
 * sandbox (an opaque origin whose base URL is `about:srcdoc`) a relative URL cannot be resolved at
 * all, and even an absolute one is a cross-site subresource request that carries no session
 * cookie — so the image comes back 403 and the slide silently has no background. Painting it in
 * the parent document sidesteps both problems; the sandbox simply stays transparent above it.
 */
export function backgroundCss(config: ReactSlideConfig, backgroundUrl?: string): string {
  const bg = config.background ?? { mode: 'none' };
  if (bg.mode === 'color' && bg.color && isSafeCssValue(bg.color)) {
    return `background-color: ${bg.color};`;
  }
  if (bg.mode === 'image' && backgroundUrl) {
    // The URL is one of ours (api/pdfs/.../background.png), but it still goes through
    // encodeURI + a quote strip so a pathological id can't close the url() and add declarations.
    const safeUrl = encodeURI(backgroundUrl).replace(/["'()\\]/g, '');
    const fit = bg.fit === 'contain' ? 'contain' : 'cover';
    const position = bg.position && isSafeCssValue(bg.position) ? bg.position : 'center';
    return `background-image: url("${safeUrl}"); background-size: ${fit}; background-position: ${position}; background-repeat: no-repeat;`;
  }
  return '';
}

/** The `#ms-bg-overlay` declarations for a config; pushed live alongside `backgroundCss`. */
export function overlayCss(config: ReactSlideConfig): string {
  const bg = config.background ?? { mode: 'none' };
  if (bg.mode !== 'image') return 'display: none;';
  const color = bg.overlayColor && isSafeCssValue(bg.overlayColor) ? bg.overlayColor : '#000000';
  const opacity = typeof bg.overlayOpacity === 'number' && bg.overlayOpacity >= 0 && bg.overlayOpacity <= 1
    ? bg.overlayOpacity
    : 0.45;
  return `background-color: ${color}; opacity: ${opacity};`;
}

/**
 * The sandbox document.
 *
 * Everything variable is passed in base64 (`compiled`, `overrides`) rather than interpolated, so
 * no slide content — user text, CSS, generated code — can close the `<script>` element or the
 * surrounding document. The runtime then does, in order: mount the component, assign element
 * paths, apply overrides. That order is why generated components must be static (a component that
 * rewrote itself after mount would wipe out the user's edits).
 */
export function buildReactSlideSandboxDoc(input: SandboxDocInput): string {
  const encodedCode = utf8ToBase64(input.compiled ?? '');
  const encodedOverrides = utf8ToBase64(JSON.stringify(input.config?.overrides ?? {}));
  const encodedProps = utf8ToBase64(JSON.stringify(EDITABLE_CSS_PROPERTIES));
  const encodedAssets = utf8ToBase64(JSON.stringify(input.assetDataUrls ?? {}));
  const layers = input.config?.textLayers ?? [];
  const encodedLayers = utf8ToBase64(JSON.stringify(layers));
  // CSS is built here rather than in the sandbox so both it and the server-side baker use the
  // same function, and so nothing in a layer is interpolated into the document as code.
  const encodedLayerCss = utf8ToBase64(
    JSON.stringify(Object.fromEntries(layers.map((layer) => [layer.id, textLayerCss(layer)]))),
  );
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
${themeCss(input.theme)}
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  /* Transparent when the frame is painting a background behind us; otherwise the theme's page colour. */
  body { background: ${hasSlideBackground(input.config, input.backgroundUrl) ? 'transparent' : 'var(--slide-bg)'}; color: var(--slide-fg); font-family: var(--slide-font-body); }
  #ms-canvas { position: relative; width: ${SLIDE_CANVAS_WIDTH}px; height: ${SLIDE_CANVAS_HEIGHT}px; overflow: hidden; }
  #ms-root { position: absolute; inset: 0; }
  /* The container spans the whole canvas, so it must not receive clicks itself — otherwise every
     click on the slide lands on it instead of the component underneath (reported as "div!" by the
     sandbox's own diagnostics). Only the layers themselves are clickable. */
  #ms-text-layers { position: absolute; inset: 0; pointer-events: none; }
  #ms-text-layers > div { pointer-events: auto; }
  body.ms-inspect #ms-text-layers > div:hover { outline: 3px solid #f59e0b !important; outline-offset: 2px; cursor: crosshair; }
  body.ms-inspect .ms-layer-selected { outline: 3px solid #f43f5e !important; outline-offset: 2px; }
  #ms-error { position: absolute; left: 0; right: 0; bottom: 0; padding: 16px 24px; font: 20px/1.4 ui-monospace, monospace; color: #fecaca; background: rgba(127,29,29,0.92); white-space: pre-wrap; display: none; }
  body.ms-inspect #ms-root *:hover { outline: 3px solid #38bdf8 !important; outline-offset: 2px; cursor: crosshair; }
  body.ms-inspect .ms-selected { outline: 3px solid #f43f5e !important; outline-offset: 2px; }
  /* A clickable element has to look clickable; in inspect mode the crosshair wins, because there
     the click selects rather than navigates. */
  /* A link has to look like a link, or the only way to discover one is to click everything. The
     underline is inherited from the text's own colour rather than forced blue: the slide's palette
     is the author's, and this is the smallest mark that still reads as "this is a link". Written
     as a stylesheet rule, so an author who sets text-decoration inline still wins.
     Kept identical in the bake document — a link that is underlined on screen and plain in the
     exported JPG is exactly the on-screen/in-the-file mismatch this whole feature exists to avoid. */
  [data-ms-href] { cursor: pointer; text-decoration: underline; text-underline-offset: 0.15em; }
  body.ms-inspect [data-ms-href] { cursor: crosshair; }
  /* Something you can pick up should say so. Only free-standing elements can be moved; the rest
     are placed by the layout, and the panel explains that when one is selected. */
  body.ms-inspect .ms-selected { cursor: move; }
  /* Deleted elements. Carried on an attribute rather than an inline style because inspect mode has
     to win: an inline !important beats every stylesheet rule, and then a deleted element could
     never be shown again to be un-deleted. */
  [data-ms-hidden="1"] { display: none !important; }
  body.ms-inspect [data-ms-hidden="1"] { display: revert !important; opacity: 0.28 !important; outline: 2px dashed #f43f5e !important; outline-offset: 2px; }
${input.theme.customCss ?? ''}
</style>
</head>
<body class="${input.inspect ? 'ms-inspect' : ''}">
<div id="ms-canvas">
  <div id="ms-root"></div>
  <div id="ms-text-layers"></div>
  <div id="ms-error"></div>
</div>
<script src="${vendorUrl('react.production.min.js')}"></script>
<script src="${vendorUrl('react-dom.production.min.js')}"></script>
<script>
(function () {
  "use strict";
  var root = document.getElementById('ms-root');
  var errorBox = document.getElementById('ms-error');
  var selected = null;
  function post(message) {
    try { parent.postMessage(message, '*'); } catch (e) { /* detached frame */ }
  }
  function fail(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
    post({ type: 'ms-slide-error', message: String(message) });
  }
  function base64ToUtf8(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  var EDITABLE = JSON.parse(base64ToUtf8("${encodedProps}"));
  /**
   * Resolve a page asset's name to something the sandbox can render.
   *
   * Defined before the slide code runs, since the code calls it while rendering. An unknown name
   * resolves to '' rather than to a guessed URL — the code is allowed to be wrong, but it is not
   * allowed to turn that into a request for something else.
   */
  var ASSETS = {};
  try { ASSETS = JSON.parse(base64ToUtf8("${encodedAssets}")) || {}; } catch (e) { ASSETS = {}; }
  window.MS_ASSET = function (name) {
    var safe = String(name == null ? '' : name);
    return Object.prototype.hasOwnProperty.call(ASSETS, safe) ? ASSETS[safe] : '';
  };
  var layersEl = document.getElementById('ms-text-layers');
  var textLayers = [];
  try { textLayers = JSON.parse(base64ToUtf8("${encodedLayers}")) || []; } catch (e) { textLayers = []; }
  var layerCss = {};
  try { layerCss = JSON.parse(base64ToUtf8("${encodedLayerCss}")) || {}; } catch (e) { layerCss = {}; }

  /** Rebuild the text layers. Cheap (a handful of divs) and keeps edits reflected immediately. */
  function renderTextLayers() {
    layersEl.textContent = '';
    for (var i = 0; i < textLayers.length; i++) {
      var layer = textLayers[i];
      var el = document.createElement('div');
      el.setAttribute('data-ms-text-layer', String(layer.id));
      el.setAttribute('style', layerCss[layer.id] || '');
      // textContent, never innerHTML: this is user text and must never be parsed as markup.
      el.textContent = String(layer.text == null ? '' : layer.text);
      layersEl.appendChild(el);
    }
  }
  var overrides = {};
  try { overrides = JSON.parse(base64ToUtf8("${encodedOverrides}")) || {}; } catch (e) { overrides = {}; }

  /**
   * Elements are addressed by the id written into the JSX (data-ms-id), which React passes
   * straight through to the DOM node. Nothing is assigned here any more: a position path was only
   * meaningful while the tree stayed static, and it could not survive an edit to the code.
   */
  function toKebab(prop) {
    return String(prop).replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
  }
  function applyOverrides(map) {
    var nodes = root.querySelectorAll('[data-ms-id]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var saved = el.getAttribute('data-ms-original-style');
      if (saved !== null) el.setAttribute('style', saved);
      var savedText = el.getAttribute('data-ms-original-text');
      if (savedText !== null && el.children.length === 0) el.textContent = savedText;
      el.removeAttribute('data-ms-hidden');
    }
    Object.keys(map || {}).forEach(function (id) {
      var el = root.querySelector('[data-ms-id="' + id.replace(/"/g, '') + '"]');
      if (!el) return;
      var override = map[id] || {};
      if (el.getAttribute('data-ms-original-style') === null) {
        el.setAttribute('data-ms-original-style', el.getAttribute('style') || '');
      }
      if (override.hidden === true) el.setAttribute('data-ms-hidden', '1');
      if (typeof override.text === 'string') {
        if (el.getAttribute('data-ms-original-text') === null) {
          el.setAttribute('data-ms-original-text', el.textContent || '');
        }
        el.textContent = override.text;
      }
      var styles = override.styles || {};
      Object.keys(styles).forEach(function (prop) {
        var kebab = toKebab(prop);
        if (EDITABLE.indexOf(kebab) === -1) return;
        // important, so an override always beats the component's own inline style / <style> rules
        el.style.setProperty(kebab, styles[prop], 'important');
      });
    });
  }

  var observer = null;
  /**
   * Give every element its path and re-apply the overrides. Idempotent: applyOverrides restores
   * the original text/style before re-applying, so running it again never compounds. The observer
   * is detached while it runs, because applying overrides mutates the DOM it watches.
   */
  function syncDom() {
    if (observer) observer.disconnect();
    try {
      applyOverrides(overrides);
    } catch (e) {
      /* keep the slide up */
    }
    if (observer) observer.observe(root, { childList: true, subtree: true });
    post({ type: 'ms-slide-stats', pathCount: root.querySelectorAll('[data-ms-id]').length });
  }

  /**
   * The element's text with its <br> breaks as newlines, or '' when it holds real markup.
   *
   * textContent would drop the breaks entirely, so the panel would show one run-on line and saving
   * it would write that back — one edit and the layout the text was lifted with is gone.
   */
  function readableText(el) {
    var nodes = el.childNodes;
    var out = '';
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType === 3) out += node.nodeValue;
      // Escaped twice on purpose: this file is a template literal, so a single-escaped newline
      // here becomes a real newline inside the sandbox's string literal and truncates it — taking
      // the whole runtime script down with a syntax error, which renders nothing at all.
      else if (node.nodeType === 1 && node.tagName === 'BR') out += '\\n';
      else return '';
    }
    return out;
  }

  /**
   * The element's content as the restricted markup the rich text editor round-trips: text, <br>
   * and coloured <span>. Returns '' for anything else, which is what makes the panel treat markup
   * it must not rewrite as read-only.
   */
  function readableHtml(el) {
    var esc = function (t) {
      return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
    var nodes = el.childNodes;
    var out = '';
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType === 3) out += esc(node.nodeValue);
      else if (node.nodeType === 1 && node.tagName === 'BR') out += '<br>';
      else if (node.nodeType === 1 && node.tagName === 'SPAN' && node.children.length === 0) {
        var colour = node.style && node.style.color ? node.style.color : '';
        out += colour ? '<span style="color: ' + colour + '">' + esc(node.textContent) + '</span>' : esc(node.textContent);
      } else return '';
    }
    return out;
  }

  function describe(el) {
    var computed = {};
    var live = getComputedStyle(el);
    for (var i = 0; i < EDITABLE.length; i++) {
      computed[EDITABLE[i]] = live.getPropertyValue(EDITABLE[i]).trim();
    }
    var own = {};
    for (var j = 0; j < el.style.length; j++) {
      var name = el.style[j];
      if (EDITABLE.indexOf(name) !== -1) own[name] = el.style.getPropertyValue(name).trim();
    }
    return {
      type: 'ms-slide-select',
      id: el.getAttribute('data-ms-id') || '',
      tagName: el.tagName.toLowerCase(),
      text: readableText(el),
      html: readableHtml(el),
      href: el.getAttribute('data-ms-href') || '',
      movable: isMovable(el),
      rect: (function () {
        var r = el.getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      })(),
      styles: own,
      computed: computed
    };
  }

  document.addEventListener('click', function (ev) {
    // Links, when not editing. The sandbox has no allow-popups and no allow-top-navigation, so an
    // <a> here would be blocked outright — the parent is asked to open it instead, and validates
    // the URL itself before doing so (docs/page-overlay-and-fusion.md §4.3). While inspect mode is
    // on, clicking is for selecting: leaving the page is not what the user means.
    if (!document.body.classList.contains('ms-inspect')) {
      var linkEl = ev.target && ev.target.closest ? ev.target.closest('[data-ms-href]') : null;
      if (linkEl) {
        ev.preventDefault();
        post({ type: 'ms-slide-link', href: linkEl.getAttribute('data-ms-href') || '' });
      }
      return;
    }
    // A text layer is its own kind of thing: it is editable data, not an element needing an
    // override, so it reports separately and the panel switches editors.
    var layerEl = ev.target && ev.target.closest ? ev.target.closest('[data-ms-text-layer]') : null;
    if (layerEl) {
      ev.preventDefault();
      ev.stopPropagation();
      if (selected) selected.classList.remove('ms-selected');
      var previous = layersEl.querySelector('.ms-layer-selected');
      if (previous) previous.classList.remove('ms-layer-selected');
      layerEl.classList.add('ms-layer-selected');
      post({ type: 'ms-slide-select-layer', layerId: layerEl.getAttribute('data-ms-text-layer') });
      return;
    }
    // Walk up to the nearest element that carries a path: clicking the padding of a card, or a
    // <strong> the generator nested inside a paragraph, should still select something rather
    // than appear to do nothing.
    var clickedTag = ev.target && ev.target.tagName ? String(ev.target.tagName).toLowerCase() : '?';
    var target = ev.target && ev.target.closest ? ev.target.closest('[data-ms-id]') : null;
    if (!target) {
      // Paths not assigned yet (or the component re-rendered): do it now rather than ignore the
      // click, which is indistinguishable from a broken inspector.
      syncDom();
      target = ev.target && ev.target.closest ? ev.target.closest('[data-ms-id]') : null;
    }
    post({
      type: 'ms-slide-stats',
      pathCount: root.querySelectorAll('[data-ms-id]').length,
      lastClick: clickedTag + (target ? '' : '!'),
    });
    if (!target) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (selected) selected.classList.remove('ms-selected');
    selected = target;
    selected.classList.add('ms-selected');
    post(describe(target));
  }, true);

  /**
   * Del inside the sandbox.
   *
   * The parent cannot see this: clicking a slide element puts focus in the iframe, and an opaque
   * origin gives the parent no way to read its key events — so pressing Del right after selecting
   * something, which is exactly when a user would, would do nothing at all. The sandbox forwards
   * the intent and the parent decides what "delete" means (an element override, or a text layer).
   */
  /**
   * Dragging an element to move it (docs/page-overlay-and-fusion.md §4.4).
   *
   * The iframe is exactly 1920×1080 and the fit-to-container scaling lives on the element itself,
   * so coordinates in here are already canvas coordinates — a pointer delta is a canvas delta with
   * no conversion at all.
   *
   * Only absolutely positioned elements move. Everything else is placed by the layout, and writing
   * left/top onto it either does nothing (static) or shifts it relative to where the layout put it
   * (relative) — both of which read as "dragging is broken". Those report why instead, and the
   * panel offers to make the element free-standing.
   */
  var drag = null;
  /** px moved before a press counts as a drag; below it, the gesture is still a click (a selection). */
  var DRAG_THRESHOLD = 3;

  /** The numeric value and unit of an inline length, defaulting to px so an unset one still moves. */
  function readLength(el, prop) {
    var inline = el.style.getPropertyValue(prop);
    var match = /^(-?[\\d.]+)(px|%)$/.exec(String(inline).trim());
    if (match) return { value: parseFloat(match[1]), unit: match[2] };
    // No inline value: fall back to where the layout actually put it, in px.
    var rect = el.getBoundingClientRect();
    return { value: prop === 'left' ? rect.left : rect.top, unit: 'px' };
  }

  /** Canvas px -> the unit this element is already using, so dragging never rewrites % into px. */
  function toUnit(px, unit, axis) {
    if (unit !== '%') return { value: Math.round(px), unit: 'px' };
    var extent = axis === 'x' ? ${SLIDE_CANVAS_WIDTH} : ${SLIDE_CANVAS_HEIGHT};
    return { value: Math.round((px / extent) * 1000) / 10, unit: '%' };
  }

  function isMovable(el) {
    var position = getComputedStyle(el).position;
    return position === 'absolute' || position === 'fixed';
  }

  function applyMove(el, leftPx, topPx, units) {
    var left = toUnit(leftPx, units.left, 'x');
    var top = toUnit(topPx, units.top, 'y');
    el.style.setProperty('left', left.value + left.unit);
    el.style.setProperty('top', top.value + top.unit);
    return { left: left.value + left.unit, top: top.value + top.unit };
  }

  document.addEventListener('pointerdown', function (ev) {
    if (!document.body.classList.contains('ms-inspect')) return;
    var target = ev.target && ev.target.closest ? ev.target.closest('[data-ms-id]') : null;
    if (!target || !isMovable(target)) return;
    var left = readLength(target, 'left');
    var top = readLength(target, 'top');
    drag = {
      el: target,
      startX: ev.clientX,
      startY: ev.clientY,
      originLeft: left.unit === '%' ? (left.value / 100) * ${SLIDE_CANVAS_WIDTH} : left.value,
      originTop: top.unit === '%' ? (top.value / 100) * ${SLIDE_CANVAS_HEIGHT} : top.value,
      units: { left: left.unit, top: top.unit },
      moved: false,
    };
  }, true);

  document.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.startX;
    var dy = ev.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    ev.preventDefault();
    applyMove(drag.el, drag.originLeft + dx, drag.originTop + dy, drag.units);
  }, true);

  document.addEventListener('pointerup', function (ev) {
    if (!drag) return;
    var current = drag;
    drag = null;
    if (!current.moved) return;
    // Swallow the click this press would otherwise produce: a drag that ends on another element
    // must not also reselect whatever the pointer happened to be over.
    ev.preventDefault();
    ev.stopPropagation();
    var applied = applyMove(
      current.el,
      current.originLeft + (ev.clientX - current.startX),
      current.originTop + (ev.clientY - current.startY),
      current.units,
    );
    post({ type: 'ms-slide-move', id: current.el.getAttribute('data-ms-id') || '', left: applied.left, top: applied.top });
  }, true);

  document.addEventListener('keydown', function (ev) {
    if (!document.body.classList.contains('ms-inspect')) return;
    // Arrow keys nudge the selection. Dragging is for placing something roughly; this is for the
    // last few pixels, which is not a thing a pointer is good at.
    var arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[ev.key] && selected && isMovable(selected)) {
      var tag0 = ev.target && ev.target.tagName ? String(ev.target.tagName).toLowerCase() : '';
      if (tag0 === 'input' || tag0 === 'textarea' || tag0 === 'select') return;
      ev.preventDefault();
      var step = ev.shiftKey ? 10 : 1;
      var left0 = readLength(selected, 'left');
      var top0 = readLength(selected, 'top');
      var leftPx = left0.unit === '%' ? (left0.value / 100) * ${SLIDE_CANVAS_WIDTH} : left0.value;
      var topPx = top0.unit === '%' ? (top0.value / 100) * ${SLIDE_CANVAS_HEIGHT} : top0.value;
      var moved = applyMove(
        selected,
        leftPx + arrows[ev.key][0] * step,
        topPx + arrows[ev.key][1] * step,
        { left: left0.unit, top: top0.unit },
      );
      post({ type: 'ms-slide-move', id: selected.getAttribute('data-ms-id') || '', left: moved.left, top: moved.top });
      return;
    }
    if (ev.key !== 'Delete') return;
    var t = ev.target;
    var tag = t && t.tagName ? String(t.tagName).toLowerCase() : '';
    // Never steal the key from something being typed into (a slide can contain an <input>).
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
    ev.preventDefault();
    post({ type: 'ms-slide-delete-request' });
  });

  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'ms-slide-inspect') {
      document.body.classList.toggle('ms-inspect', !!data.enabled);
      if (!data.enabled && selected) { selected.classList.remove('ms-selected'); selected = null; }
    } else if (data.type === 'ms-slide-background') {
      document.body.style.background = data.transparent ? 'transparent' : 'var(--slide-bg)';
    } else if (data.type === 'ms-slide-theme') {
      var tokens = data.tokens || {};
      Object.keys(tokens).forEach(function (key) {
        if (key.indexOf('--slide-') !== 0) return;
        document.documentElement.style.setProperty(key, String(tokens[key]));
      });
    } else if (data.type === 'ms-slide-overrides') {
      overrides = data.overrides || {};
      syncDom();
    } else if (data.type === 'ms-slide-text-layers') {
      textLayers = data.layers || [];
      layerCss = data.css || {};
      renderTextLayers();
    }
  });

  try {
    if (!window.React || !window.ReactDOM) {
      fail('React runtime failed to load');
      return;
    }
    var code = "${encodedCode}" ? base64ToUtf8("${encodedCode}") : '';
    if (code) new Function(code)();
    if (typeof window.SlideComponent !== 'function') {
      fail('Slide code did not define window.SlideComponent');
      return;
    }
    ReactDOM.createRoot(root).render(React.createElement(window.SlideComponent));
    // React 18 schedules the commit, so it can land *after* the next animation frame. Assigning
    // paths once on that frame therefore walked an empty root on slower machines: no element
    // carried a path, so clicks selected nothing and saved overrides were never applied — while
    // the hover outline (pure CSS, no path needed) still worked, making it look as if only the
    // panel were broken. Re-sync whenever the component's DOM changes instead.
    observer = new MutationObserver(function () { syncDom(); });
    syncDom();
    renderTextLayers();
    requestAnimationFrame(function () {
      syncDom();
      post({ type: 'ms-slide-ready' });
    });
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
})();
</script>
</body>
</html>`;
}
