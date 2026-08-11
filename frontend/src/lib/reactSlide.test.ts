import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLIDE_THEME_TOKENS,
  EDITABLE_CSS_PROPERTIES,
  SLIDE_CANVAS_WIDTH,
  buildReactSlideSandboxDoc,
  defaultReactSlideConfig,
  defaultSlideTheme,
  describeOverride,
  isEditableCssProperty,
  isSafeCssValue,
  isSlideSandboxMessage,
  isValidElementPath,
  normalizeStyleOverrides,
  slideScale,
} from './reactSlide';

// ── css whitelist ──────────────────────────────────────────────────────────

test('isSafeCssValue rejects external resources and rule breakouts', () => {
  assert.equal(isSafeCssValue('48px'), true);
  assert.equal(isSafeCssValue('var(--slide-accent)'), true);
  assert.equal(isSafeCssValue('url(https://evil.example/a.png)'), false);
  assert.equal(isSafeCssValue('red; position: fixed'), false);
  assert.equal(isSafeCssValue('}'), false);
  assert.equal(isSafeCssValue(''), false);
});

test('isEditableCssProperty follows the whitelist, excluding resource-loading properties', () => {
  assert.equal(isEditableCssProperty('color'), true);
  assert.equal(isEditableCssProperty('background-image'), false);
  assert.equal(isEditableCssProperty('position'), false);
});

test('normalizeStyleOverrides drops unknown properties, unsafe values and non-strings', () => {
  const styles = normalizeStyleOverrides({
    'font-size': ' 64px ',
    'background-image': 'url(x)',
    color: 'red; top: 0',
    opacity: 1 as unknown as string,
  });
  assert.deepEqual(styles, { 'font-size': '64px' });
});

// ── element paths ──────────────────────────────────────────────────────────

test('isValidElementPath accepts index chains and nothing else', () => {
  assert.equal(isValidElementPath('0'), true);
  assert.equal(isValidElementPath('0/2/1'), true);
  assert.equal(isValidElementPath('0//1'), false);
  assert.equal(isValidElementPath('h1 > span'), false);
  assert.equal(isValidElementPath('0/'.repeat(200)), false);
});

test('describeOverride summarizes text and style counts', () => {
  assert.match(describeOverride('0/1', { text: '標題', styles: { color: '#fff' } }), /"標題".*1 CSS/);
});

// ── scaling ────────────────────────────────────────────────────────────────

test('slideScale maps the container width onto the 1920px canvas', () => {
  assert.equal(slideScale(SLIDE_CANVAS_WIDTH), 1);
  assert.equal(slideScale(960), 0.5);
  assert.equal(slideScale(0), 1);
  assert.equal(slideScale(Number.NaN), 1);
});

// ── sandbox document ───────────────────────────────────────────────────────

test('buildReactSlideSandboxDoc injects theme tokens and the canvas size', () => {
  const doc = buildReactSlideSandboxDoc({
    compiled: 'window.SlideComponent = function () { return null; };',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
  });
  assert.match(doc, /--slide-accent: #38bdf8;/);
  assert.match(doc, new RegExp(`width: ${SLIDE_CANVAS_WIDTH}px`));
  assert.match(doc, /sandbox|ms-canvas/);
});

test('buildReactSlideSandboxDoc never inlines slide code as literal script text', () => {
  const doc = buildReactSlideSandboxDoc({
    compiled: 'window.SlideComponent = function () { return "</script><script>alert(1)</script>"; };',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
  });
  // The code is base64-encoded, so the payload's closing tag can never appear verbatim.
  assert.equal(doc.includes('alert(1)'), false);
});

test('buildReactSlideSandboxDoc falls back to the default token when a theme value is unsafe', () => {
  const theme = defaultSlideTheme();
  theme.tokens['--slide-bg'] = 'url(https://evil.example/x.png)';
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme,
    config: defaultReactSlideConfig(),
  });
  assert.match(doc, new RegExp(`--slide-bg: ${DEFAULT_SLIDE_THEME_TOKENS['--slide-bg']};`));
  assert.equal(doc.includes('evil.example'), false);
});

test('buildReactSlideSandboxDoc renders a color background but ignores an unsafe one', () => {
  const safe = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: { ...defaultReactSlideConfig(), background: { mode: 'color', color: '#123456' } },
  });
  assert.match(safe, /background-color: #123456;/);

  const unsafe = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: { ...defaultReactSlideConfig(), background: { mode: 'color', color: 'red;top:0' } },
  });
  assert.equal(unsafe.includes('red;top:0'), false);
});

test('buildReactSlideSandboxDoc wires up the background image and its overlay', () => {
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: {
      ...defaultReactSlideConfig(),
      background: { mode: 'image', file: 'pages/x.slide-bg.png', fit: 'contain', overlayOpacity: 0.6 },
    },
    backgroundUrl: 'api/pdfs/abc12345/pages/1/react-slide/background.png?v=1',
  });
  assert.match(doc, /background-image: url\("api\/pdfs\/abc12345/);
  assert.match(doc, /background-size: contain;/);
  assert.match(doc, /opacity: 0\.6;/);
});

test('buildReactSlideSandboxDoc exposes exactly the whitelisted properties to the runtime', () => {
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
  });
  const match = /var EDITABLE = JSON\.parse\(base64ToUtf8\("([^"]*)"\)\)/.exec(doc);
  assert.ok(match, 'sandbox should carry the editable property list');
  const decoded = JSON.parse(Buffer.from(match[1] ?? '', 'base64').toString('utf8')) as string[];
  assert.deepEqual(decoded, [...EDITABLE_CSS_PROPERTIES]);
});

// ── message guard ──────────────────────────────────────────────────────────

test('isSlideSandboxMessage only accepts the sandbox protocol', () => {
  assert.equal(isSlideSandboxMessage({ type: 'ms-slide-ready' }), true);
  assert.equal(isSlideSandboxMessage({ type: 'ms-slide-select', path: '0' }), true);
  assert.equal(isSlideSandboxMessage({ type: 'something-else' }), false);
  assert.equal(isSlideSandboxMessage(null), false);
  assert.equal(isSlideSandboxMessage('ms-slide-ready'), false);
});
