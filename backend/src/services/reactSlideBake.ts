import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config';
import { db } from '../db';
import { logger } from '../logger';
import {
  pageImagePath,
  pageReactSlideBackgroundPath,
  pageReactSlideCompiledPath,
  pageReactSlideConfigPath,
  safeJoinPdfPath,
} from './storage';
import { generatePageThumbnail } from './thumbnails';
import { commitPresentationFile } from './presentationGit';
import {
  DEFAULT_SLIDE_THEME_TOKENS,
  EDITABLE_CSS_PROPERTIES,
  SLIDE_THEME_TOKEN_KEYS,
  isSafeCssValue,
  parseStoredReactSlideConfig,
  defaultReactSlideConfig,
  type ReactSlideConfig,
  type SlideTheme,
} from './reactSlide';
import { readStoredSlideTheme } from './reactSlidePage';

/**
 * Baking a React slide into the page's JPG (docs/react-slide-design.md §12.1).
 *
 * A React page's picture is code, but every export path — PDF, PPTX, video, SCORM, the thumbnail
 * strip, the deck cover — consumes `<page_uid>.jpg`. Until this existed those exports silently
 * shipped whatever image the page had *before* it became a React slide: the deck looked right on
 * screen and wrong in every file you handed out. Baking renders the page exactly as the viewer
 * sees it and writes that back to the JPG, so the rest of the product needs no changes at all.
 *
 * The renderer is a headless browser, because the slide is real HTML/CSS laid out by a real
 * layout engine — anything less (SSR to SVG, a canvas approximation) would produce a picture that
 * differs from what the user approved on screen, which is worse than an out-of-date one.
 */

/** Canvas the sandbox lays out against; the JPG matches it 1:1 so nothing is rescaled twice. */
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

/** Matches the pipeline's own slide JPEGs, so a baked page is indistinguishable from a rendered one. */
const JPEG_QUALITY = 82;

/** Hard cap on one bake, so a pathological slide cannot wedge the request or the queue. */
const BAKE_TIMEOUT_MS = 30_000;

export class BakeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BakeUnavailableError';
  }
}

/**
 * Locate the React UMD bundles the sandbox document loads.
 *
 * They are inlined into the baking document rather than fetched: the headless page is opened with
 * `setContent`, which has no origin to resolve a relative URL against, and inlining also keeps
 * baking working on a machine with no network at all.
 */
function vendorScriptSource(file: string): string {
  const candidates = [
    path.join(config.repoRoot, 'frontend', 'dist', 'vendor', file),
    path.join(config.repoRoot, 'frontend', 'public', 'vendor', file),
  ];
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, 'utf8');
    } catch {
      // try the next location
    }
  }
  throw new BakeUnavailableError(`React runtime not found for baking (looked in ${candidates.join(', ')})`);
}

function themeCss(theme: SlideTheme): string {
  return SLIDE_THEME_TOKEN_KEYS.map((key) => {
    const value = theme.tokens?.[key] ?? DEFAULT_SLIDE_THEME_TOKENS[key];
    return `  ${key}: ${isSafeCssValue(value) ? value : DEFAULT_SLIDE_THEME_TOKENS[key]};`;
  }).join('\n');
}

/** Base64 `data:` URL for the page's generated background, or null when it has none. */
export function backgroundDataUrl(pdfId: string, pageUid: string, config_: ReactSlideConfig): string | null {
  if (config_.background?.mode !== 'image') return null;
  try {
    const buffer = fs.readFileSync(pageReactSlideBackgroundPath(pdfId, pageUid));
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

function backgroundCss(config_: ReactSlideConfig, dataUrl: string | null): string {
  const bg = config_.background ?? { mode: 'none' };
  if (bg.mode === 'color' && bg.color && isSafeCssValue(bg.color)) {
    return `background-color: ${bg.color};`;
  }
  if (bg.mode === 'image' && dataUrl) {
    const fit = bg.fit === 'contain' ? 'contain' : 'cover';
    const position = bg.position && isSafeCssValue(bg.position) ? bg.position : 'center';
    return `background-image: url("${dataUrl}"); background-size: ${fit}; background-position: ${position}; background-repeat: no-repeat;`;
  }
  return '';
}

function overlayCss(config_: ReactSlideConfig, dataUrl: string | null): string {
  const bg = config_.background ?? { mode: 'none' };
  if (bg.mode !== 'image' || !dataUrl) return 'display: none;';
  const color = bg.overlayColor && isSafeCssValue(bg.overlayColor) ? bg.overlayColor : '#000000';
  const opacity = typeof bg.overlayOpacity === 'number' && bg.overlayOpacity >= 0 && bg.overlayOpacity <= 1
    ? bg.overlayOpacity
    : 0.45;
  return `background-color: ${color}; opacity: ${opacity};`;
}

function utf8ToBase64(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64');
}

export interface BakeDocumentInput {
  compiled: string;
  theme: SlideTheme;
  config: ReactSlideConfig;
  backgroundDataUrl: string | null;
  /** Inlined React + ReactDOM UMD sources. */
  reactSource: string;
  reactDomSource: string;
}

/**
 * The document the headless browser renders.
 *
 * Deliberately the *static* half of the viewer's sandbox: same canvas, same theme tokens, same
 * background layering, same override application — but no inspector, no postMessage channel, no
 * hover outlines, since none of that belongs in a picture. `window.__msSlideReady` flips when the
 * component has mounted and the overrides are on, which is what the screenshot waits for; without
 * it a fast screenshot catches an empty page (React 18 commits asynchronously).
 */
export function buildBakeDocument(input: BakeDocumentInput): string {
  const encodedCode = utf8ToBase64(input.compiled ?? '');
  const encodedOverrides = utf8ToBase64(JSON.stringify(input.config?.overrides ?? {}));
  const hasBackground = Boolean(
    (input.config.background?.mode === 'color' && input.config.background.color)
    || (input.config.background?.mode === 'image' && input.backgroundDataUrl),
  );
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
:root {
${themeCss(input.theme)}
}
  html, body { margin: 0; padding: 0; width: ${CANVAS_WIDTH}px; height: ${CANVAS_HEIGHT}px; overflow: hidden; }
  body { background: ${hasBackground ? 'transparent' : 'var(--slide-bg)'}; color: var(--slide-fg); font-family: var(--slide-font-body); }
  #ms-canvas { position: relative; width: ${CANVAS_WIDTH}px; height: ${CANVAS_HEIGHT}px; overflow: hidden; }
  #ms-bg { position: absolute; inset: 0; ${backgroundCss(input.config, input.backgroundDataUrl)} }
  #ms-bg-overlay { position: absolute; inset: 0; ${overlayCss(input.config, input.backgroundDataUrl)} }
  #ms-root { position: absolute; inset: 0; }
${input.theme.customCss ?? ''}
</style>
</head>
<body>
<div id="ms-canvas">
  <div id="ms-bg"></div>
  <div id="ms-bg-overlay"></div>
  <div id="ms-root"></div>
</div>
<script>${input.reactSource}</script>
<script>${input.reactDomSource}</script>
<script>
(function () {
  "use strict";
  var root = document.getElementById('ms-root');
  function base64ToUtf8(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  var overrides = {};
  try { overrides = JSON.parse(base64ToUtf8("${encodedOverrides}")) || {}; } catch (e) { overrides = {}; }
  var EDITABLE = JSON.parse(base64ToUtf8("${utf8ToBase64(JSON.stringify([...EDITABLE_CSS_PROPERTIES]))}"));

  function assignPaths(node, prefix) {
    var children = node.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var p = prefix === '' ? String(i) : prefix + '/' + String(i);
      child.setAttribute('data-ms-path', p);
      assignPaths(child, p);
    }
  }
  function toKebab(prop) {
    return String(prop).replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
  }
  function applyOverrides() {
    Object.keys(overrides || {}).forEach(function (p) {
      var el = root.querySelector('[data-ms-path="' + p.replace(/"/g, '') + '"]');
      if (!el) return;
      var override = overrides[p] || {};
      if (typeof override.text === 'string') el.textContent = override.text;
      var styles = override.styles || {};
      Object.keys(styles).forEach(function (prop) {
        var kebab = toKebab(prop);
        if (EDITABLE.indexOf(kebab) === -1) return;
        el.style.setProperty(kebab, styles[prop], 'important');
      });
    });
  }
  try {
    var code = "${encodedCode}" ? base64ToUtf8("${encodedCode}") : '';
    if (code) new Function(code)();
    if (typeof window.SlideComponent !== 'function') {
      window.__msSlideError = 'Slide code did not define window.SlideComponent';
      window.__msSlideReady = true;
      return;
    }
    ReactDOM.createRoot(root).render(React.createElement(window.SlideComponent));
    // React 18 commits asynchronously: poll until the component has produced DOM (or we give up),
    // then label and restyle, so the screenshot can never catch a half-rendered page.
    var attempts = 0;
    (function settle() {
      attempts += 1;
      if (root.children.length === 0 && attempts < 120) {
        requestAnimationFrame(settle);
        return;
      }
      assignPaths(root, '');
      applyOverrides();
      requestAnimationFrame(function () { window.__msSlideReady = true; });
    })();
  } catch (e) {
    window.__msSlideError = e && e.message ? e.message : String(e);
    window.__msSlideReady = true;
  }
})();
</script>
</body>
</html>`;
}

interface BakePageRow {
  page_uid: string;
  render_type: string | null;
  react_slide_path: string | null;
}

/**
 * Render the page in a headless browser and return the JPEG.
 *
 * `playwright-core` is imported dynamically and no browser is downloaded: the launch uses the
 * machine's installed Chrome/Chromium (or `CHROME_PATH`). A deployment without one gets a clear
 * BakeUnavailableError instead of a stack trace, because baking is an optional enhancement — the
 * page still renders for viewers either way.
 */
export async function renderSlideToJpeg(html: string): Promise<Buffer> {
  let chromium: typeof import('playwright-core').chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new BakeUnavailableError('playwright-core is not installed, so React pages cannot be baked');
  }

  const executablePath = process.env.CHROME_PATH?.trim() || undefined;
  let browser;
  try {
    browser = executablePath
      ? await chromium.launch({ executablePath })
      : await chromium.launch({ channel: 'chrome' });
  } catch (err) {
    throw new BakeUnavailableError(
      `No Chrome/Chromium available for baking React pages (set CHROME_PATH to point at one): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  try {
    const page = await browser.newPage({
      viewport: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: 'load', timeout: BAKE_TIMEOUT_MS });
    await page.waitForFunction('window.__msSlideReady === true', undefined, { timeout: BAKE_TIMEOUT_MS });
    const slideError = await page.evaluate('window.__msSlideError ?? null');
    if (typeof slideError === 'string' && slideError) {
      throw new Error(`Slide code failed while baking: ${slideError}`);
    }
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT } });
    return await sharp(png).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  } finally {
    await browser.close().catch(() => {});
  }
}

export interface BakeResult {
  /** Relative path of the page image that was written. */
  relImagePath: string;
  bytes: number;
}

/**
 * Bake one React page into its JPG + thumbnail and point the DB at it.
 *
 * Throws `BakeUnavailableError` when the environment cannot render (no browser, no React runtime)
 * so callers can distinguish "not supported here" from "this slide is broken".
 */
export async function bakeReactSlidePage(pdfId: string, pageNumber: number): Promise<BakeResult> {
  const row = db
    .prepare(`SELECT page_uid, render_type, react_slide_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
    .get(pdfId, pageNumber) as BakePageRow | undefined;
  if (!row) throw new Error(`Page ${pageNumber} not found`);
  if (row.render_type !== 'react') throw new Error(`Page ${pageNumber} is not a React slide`);

  let compiled: string;
  try {
    compiled = fs.readFileSync(pageReactSlideCompiledPath(pdfId, row.page_uid), 'utf8');
  } catch {
    throw new Error(`Page ${pageNumber} has no compiled React slide to bake`);
  }

  let slideConfig: ReactSlideConfig;
  try {
    slideConfig = parseStoredReactSlideConfig(fs.readFileSync(pageReactSlideConfigPath(pdfId, row.page_uid), 'utf8'));
  } catch {
    slideConfig = defaultReactSlideConfig();
  }

  const html = buildBakeDocument({
    compiled,
    theme: readStoredSlideTheme(pdfId),
    config: slideConfig,
    backgroundDataUrl: backgroundDataUrl(pdfId, row.page_uid, slideConfig),
    reactSource: vendorScriptSource('react.production.min.js'),
    reactDomSource: vendorScriptSource('react-dom.production.min.js'),
  });

  const jpeg = await renderSlideToJpeg(html);
  const imagePath = pageImagePath(pdfId, row.page_uid);
  await fs.promises.writeFile(imagePath, jpeg);
  await generatePageThumbnail(pdfId, row.page_uid, imagePath);

  const relImagePath = path.posix.join('pages', `${row.page_uid}.jpg`);
  db.prepare(`UPDATE pages SET image_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(
    relImagePath,
    new Date().toISOString(),
    pdfId,
    pageNumber,
  );
  void commitPresentationFile(pdfId, relImagePath, `image: bake React slide page ${pageNumber}`);

  return { relImagePath, bytes: jpeg.length };
}

/**
 * In-flight bakes, keyed by page. A save is often followed immediately by another (typing in the
 * code editor, dragging a slider), and each one would otherwise start its own browser; this keeps
 * one per page and coalesces the rest onto the newest request.
 */
const pendingBakes = new Map<string, Promise<void>>();

/**
 * Bake in the background after a change, never blocking the response.
 *
 * Failures are logged, not surfaced: the page renders correctly for viewers regardless, and the
 * only casualty is that exports keep the previous image until the next successful bake. Making a
 * save fail because a screenshot failed would be a much worse trade.
 */
export function scheduleReactSlideBake(pdfId: string, pageNumber: number): void {
  const key = `${pdfId}:${pageNumber}`;
  if (pendingBakes.has(key)) return;
  const task = (async () => {
    try {
      const result = await bakeReactSlidePage(pdfId, pageNumber);
      logger.info({ pdfId, pageNumber, bytes: result.bytes }, 'Baked React slide into the page image');
    } catch (err) {
      if (err instanceof BakeUnavailableError) {
        logger.warn({ pdfId, pageNumber, err: err.message }, 'React slide baking unavailable in this environment');
      } else {
        logger.warn({ pdfId, pageNumber, err }, 'React slide baking failed (exports keep the previous image)');
      }
    } finally {
      pendingBakes.delete(key);
    }
  })();
  pendingBakes.set(key, task);
}

/** True while a bake for this page is still running (used by the API's status reply). */
export function isBakePending(pdfId: string, pageNumber: number): boolean {
  return pendingBakes.has(`${pdfId}:${pageNumber}`);
}
