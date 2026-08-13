import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CSS_PROPERTY_CHOICES,
  DEFAULT_SLIDE_THEME_TOKENS,
  EDITABLE_CSS_PROPERTIES,
  SLIDE_CANVAS_WIDTH,
  backgroundStyle,
  buildReactSlideSandboxDoc,
  defaultReactSlideConfig,
  hasSlideBackground,
  overlayStyle,
  defaultSlideTheme,
  describeOverride,
  isEditableCssProperty,
  isSafeCssValue,
  isSlideSandboxMessage,
  isValidElementPath,
  normalizeStyleOverrides,
  parseLengthValue,
  cssColorToHex,
  slideScale,
  withStyleOverride,
  withTextOverride,
  QUICK_CSS_PROPERTIES,
  isEditableCssProperty as isEditable,
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

test('the background lives outside the sandbox, which stays transparent behind it', () => {
  // The image endpoint needs our session cookie; a cross-site request from the opaque-origin
  // sandbox carries none (403), so the frame paints the background and the sandbox shows through.
  const withImage = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: { ...defaultReactSlideConfig(), background: { mode: 'image', file: 'pages/x.slide-bg.png' } },
    backgroundUrl: 'api/pdfs/abc12345/pages/1/react-slide/background.png?v=1',
  });
  assert.match(withImage, /body \{ background: transparent;/);
  assert.equal(withImage.includes('background-image'), false);

  const plain = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
  });
  assert.match(plain, /body \{ background: var\(--slide-bg\);/);
});

test('hasSlideBackground only counts a background that can actually be painted', () => {
  const base = defaultReactSlideConfig();
  assert.equal(hasSlideBackground(base), false);
  // "image" before one has been generated, and "color" with no colour, are both "nothing yet".
  assert.equal(hasSlideBackground({ ...base, background: { mode: 'image' } }), false);
  assert.equal(hasSlideBackground({ ...base, background: { mode: 'color' } }), false);
  assert.equal(hasSlideBackground({ ...base, background: { mode: 'color', color: '#123456' } }), true);
  assert.equal(hasSlideBackground({ ...base, background: { mode: 'image', file: 'x.png' } }, 'api/x.png'), true);
});

test('backgroundStyle paints colour and image, and refuses an unsafe value', () => {
  const base = defaultReactSlideConfig();
  assert.deepEqual(backgroundStyle({ ...base, background: { mode: 'color', color: '#123456' } }), {
    backgroundColor: '#123456',
  });
  assert.deepEqual(backgroundStyle({ ...base, background: { mode: 'color', color: 'red;top:0' } }), {});
  const image = backgroundStyle(
    { ...base, background: { mode: 'image', file: 'x.png', fit: 'contain' } },
    'api/pdfs/abc12345/pages/1/react-slide/background.png?v=1',
  );
  assert.match(String(image.backgroundImage), /^url\("api\/pdfs\/abc12345/);
  assert.equal(image.backgroundSize, 'contain');
});

test('overlayStyle scrims an image background and disappears otherwise', () => {
  const base = defaultReactSlideConfig();
  assert.deepEqual(overlayStyle(base), { display: 'none' });
  assert.deepEqual(overlayStyle({ ...base, background: { mode: 'image', overlayColor: '#0f172a', overlayOpacity: 0.6 } }), {
    backgroundColor: '#0f172a',
    opacity: 0.6,
  });
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

// ── inspector helpers ──────────────────────────────────────────────────────

test('cssColorToHex converts what computed styles actually return', () => {
  // Computed styles come back as rgb(); a color input silently shows black for those.
  assert.equal(cssColorToHex('rgb(15, 23, 42)'), '#0f172a');
  assert.equal(cssColorToHex('rgba(56, 189, 248, 0.5)'), '#38bdf8');
  assert.equal(cssColorToHex('#38BDF8'), '#38bdf8');
  assert.equal(cssColorToHex('#abc'), '#aabbcc');
});

test('cssColorToHex returns null rather than a misleading swatch for unresolvable colors', () => {
  assert.equal(cssColorToHex('transparent'), null);
  assert.equal(cssColorToHex('currentColor'), null);
  assert.equal(cssColorToHex('linear-gradient(red, blue)'), null);
  // An unset background computes to rgba(0,0,0,0); a black swatch would read as "this is black".
  assert.equal(cssColorToHex('rgba(0, 0, 0, 0)'), null);
  assert.equal(cssColorToHex('rgba(0, 0, 0, 0.5)'), '#000000');
  assert.equal(cssColorToHex(undefined), null);
});

test('parseLengthValue splits a single length into number and unit', () => {
  assert.deepEqual(parseLengthValue('88px'), { number: 88, unit: 'px' });
  assert.deepEqual(parseLengthValue('1.5rem'), { number: 1.5, unit: 'rem' });
  assert.deepEqual(parseLengthValue('-4px'), { number: -4, unit: 'px' });
  assert.deepEqual(parseLengthValue('50'), { number: 50, unit: '' });
});

test('parseLengthValue rejects compound and non-length values', () => {
  assert.equal(parseLengthValue('8px 16px'), null);
  assert.equal(parseLengthValue('auto'), null);
  assert.equal(parseLengthValue(''), null);
  assert.equal(parseLengthValue(undefined), null);
});

test('withStyleOverride adds, replaces and clears one property', () => {
  const added = withStyleOverride(undefined, 'color', ' #fff ');
  assert.deepEqual(added, { styles: { color: '#fff' } });
  const replaced = withStyleOverride(added ?? undefined, 'color', '#000');
  assert.deepEqual(replaced, { styles: { color: '#000' } });
  // An emptied field means "clear this tweak", not "set it to the empty string".
  assert.equal(withStyleOverride(replaced ?? undefined, 'color', '  '), null);
});

test('withStyleOverride keeps the text override when styles are cleared', () => {
  const both = { text: '標題', styles: { color: '#fff' } };
  assert.deepEqual(withStyleOverride(both, 'color', ''), { text: '標題' });
});

test('withTextOverride keeps styles and drops the entry when nothing is left', () => {
  assert.deepEqual(withTextOverride({ styles: { color: '#fff' } }, '新標題'), {
    text: '新標題',
    styles: { color: '#fff' },
  });
  assert.equal(withTextOverride({ text: 'x' }, undefined), null);
});

test('every quick property and every choice list refers to a whitelisted property', () => {
  for (const property of QUICK_CSS_PROPERTIES) assert.equal(isEditable(property), true, property);
  for (const property of Object.keys(CSS_PROPERTY_CHOICES)) assert.equal(isEditable(property), true, property);
});

test('buildReactSlideSandboxDoc bakes the initial inspect state into the document', () => {
  // The "inspect on" postMessage can be lost if the frame loads before the parent listener is
  // attached; without the baked-in class, clicking the slide would then silently do nothing.
  const on = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
    inspect: true,
  });
  assert.match(on, /<body class="ms-inspect">/);
  const off = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
  });
  assert.match(off, /<body class="">/);
});

test('the sandbox selects the nearest element carrying a path, not only exact hits', () => {
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
  });
  // Clicking a card's padding or a nested <strong> must still select something.
  assert.match(doc, /closest\('\[data-ms-path\]'\)/);
});
