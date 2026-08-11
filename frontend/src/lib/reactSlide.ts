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
  text?: string;
  styles?: Record<string, string>;
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
  updated_at?: string;
}

export function defaultReactSlideConfig(): ReactSlideConfig {
  return { version: 1, overrides: {}, background: { mode: 'none' } };
}

/** Payload the sandbox posts up when the user clicks an element in inspect mode. */
export interface SlideElementSelection {
  path: string;
  tagName: string;
  text: string;
  /** The element's own inline styles, as a starting point for editing. */
  styles: Record<string, string>;
  /** Computed values for the whitelisted properties, so the editor can show what is actually rendered. */
  computed: Record<string, string>;
}

export type SlideSandboxMessage =
  | { type: 'ms-slide-ready' }
  | { type: 'ms-slide-error'; message: string }
  | ({ type: 'ms-slide-select' } & SlideElementSelection);

export function isSlideSandboxMessage(data: unknown): data is SlideSandboxMessage {
  if (!data || typeof data !== 'object') return false;
  const type = (data as { type?: unknown }).type;
  return type === 'ms-slide-ready' || type === 'ms-slide-error' || type === 'ms-slide-select';
}

/** Scale that fits the 1920×1080 canvas into `containerWidth` px. */
export function slideScale(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 1;
  return containerWidth / SLIDE_CANVAS_WIDTH;
}

/** Element path assigned by the sandbox: element-child indices from the slide root, e.g. `0/2/1`. */
export function isValidElementPath(path: string): boolean {
  return /^\d+(\/\d+)*$/.test(path) && path.length <= 200;
}

/** Human-readable label for an override entry in the editor's list. */
export function describeOverride(path: string, override: ReactSlideOverride): string {
  const bits: string[] = [];
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
 * The `#ms-bg` declarations for a config. Exported because the frame pushes these into the live
 * sandbox on every background edit — rebuilding the whole document would remount React (and make
 * dragging the overlay-opacity slider flash the slide once per step).
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
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
${themeCss(input.theme)}
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  body { background: var(--slide-bg); color: var(--slide-fg); font-family: var(--slide-font-body); }
  #ms-canvas { position: relative; width: ${SLIDE_CANVAS_WIDTH}px; height: ${SLIDE_CANVAS_HEIGHT}px; overflow: hidden; }
  #ms-bg { position: absolute; inset: 0; ${backgroundCss(input.config, input.backgroundUrl)} }
  #ms-bg-overlay { position: absolute; inset: 0; ${overlayCss(input.config)} }
  #ms-root { position: absolute; inset: 0; }
  #ms-error { position: absolute; left: 0; right: 0; bottom: 0; padding: 16px 24px; font: 20px/1.4 ui-monospace, monospace; color: #fecaca; background: rgba(127,29,29,0.92); white-space: pre-wrap; display: none; }
  body.ms-inspect #ms-root *:hover { outline: 3px solid #38bdf8 !important; outline-offset: 2px; cursor: crosshair; }
  body.ms-inspect .ms-selected { outline: 3px solid #f43f5e !important; outline-offset: 2px; }
${input.theme.customCss ?? ''}
</style>
</head>
<body>
<div id="ms-canvas">
  <div id="ms-bg"></div>
  <div id="ms-bg-overlay"></div>
  <div id="ms-root"></div>
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
  var overrides = {};
  try { overrides = JSON.parse(base64ToUtf8("${encodedOverrides}")) || {}; } catch (e) { overrides = {}; }

  /** Assign each element the chain of its element-child indices, e.g. "0/2/1". */
  function assignPaths(node, prefix) {
    var children = node.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var path = prefix === '' ? String(i) : prefix + '/' + String(i);
      child.setAttribute('data-ms-path', path);
      assignPaths(child, path);
    }
  }
  function toKebab(prop) {
    return String(prop).replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
  }
  function applyOverrides(map) {
    var nodes = root.querySelectorAll('[data-ms-path]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var saved = el.getAttribute('data-ms-original-style');
      if (saved !== null) el.setAttribute('style', saved);
      var savedText = el.getAttribute('data-ms-original-text');
      if (savedText !== null && el.children.length === 0) el.textContent = savedText;
    }
    Object.keys(map || {}).forEach(function (path) {
      var el = root.querySelector('[data-ms-path="' + path.replace(/"/g, '') + '"]');
      if (!el) return;
      var override = map[path] || {};
      if (el.getAttribute('data-ms-original-style') === null) {
        el.setAttribute('data-ms-original-style', el.getAttribute('style') || '');
      }
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
      path: el.getAttribute('data-ms-path') || '',
      tagName: el.tagName.toLowerCase(),
      text: el.children.length === 0 ? (el.textContent || '') : '',
      styles: own,
      computed: computed
    };
  }

  document.addEventListener('click', function (ev) {
    if (!document.body.classList.contains('ms-inspect')) return;
    var target = ev.target;
    if (!target || !target.getAttribute || !target.getAttribute('data-ms-path')) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (selected) selected.classList.remove('ms-selected');
    selected = target;
    selected.classList.add('ms-selected');
    post(describe(target));
  }, true);

  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'ms-slide-inspect') {
      document.body.classList.toggle('ms-inspect', !!data.enabled);
      if (!data.enabled && selected) { selected.classList.remove('ms-selected'); selected = null; }
    } else if (data.type === 'ms-slide-background') {
      var bgEl = document.getElementById('ms-bg');
      var overlayEl = document.getElementById('ms-bg-overlay');
      if (bgEl) bgEl.style.cssText = String(data.background || '');
      if (overlayEl) overlayEl.style.cssText = String(data.overlay || '');
    } else if (data.type === 'ms-slide-theme') {
      var tokens = data.tokens || {};
      Object.keys(tokens).forEach(function (key) {
        if (key.indexOf('--slide-') !== 0) return;
        document.documentElement.style.setProperty(key, String(tokens[key]));
      });
    } else if (data.type === 'ms-slide-overrides') {
      overrides = data.overrides || {};
      try { applyOverrides(overrides); } catch (e) { /* keep the slide up */ }
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
    // createRoot renders asynchronously; paths/overrides are applied on the next frame, once the
    // component's DOM exists.
    requestAnimationFrame(function () {
      assignPaths(root, '');
      applyOverrides(overrides);
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
