import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CSS_PROPERTY_CHOICES,
  DEFAULT_SLIDE_THEME_TOKENS,
  EDITABLE_CSS_PROPERTIES,
  SLIDE_CANVAS_WIDTH,
  SLIDE_CANVAS_HEIGHT,
  backgroundStyle,
  buildReactSlideSandboxDoc,
  isOpenableSlideLink,
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
  slideFitScale,
  slideFrameBoxStyle,
  withHiddenOverride,
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
  assert.equal(isEditableCssProperty('content'), false);
  // `position` is editable — placement became editable when lifted text became a real element, and
  // dragging is editing exactly these.
  assert.equal(isEditableCssProperty('position'), true);
  assert.equal(isEditableCssProperty('left'), true);
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

test('the sandbox selects the nearest element carrying an id, not only exact hits', () => {
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
  });
  // Clicking a card's padding or a nested <strong> must still select something.
  assert.match(doc, /closest\('\[data-ms-id\]'\)/);
});

test('the text-layer container never intercepts clicks meant for the slide', () => {
  // It spans the whole canvas: without pointer-events:none every click lands on it instead of the
  // component underneath, which is exactly how it broke — the sandbox reported "div!" for each one.
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
  });
  assert.match(doc, /#ms-text-layers \{[^}]*pointer-events: none/);
  assert.match(doc, /#ms-text-layers > div \{ pointer-events: auto/);
});

test('text layers reach the sandbox with their CSS precomputed', () => {
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: {
      ...defaultReactSlideConfig(),
      textLayers: [{
        id: 'l1', xPct: 10, yPct: 20, widthPct: 40, heightPct: 10,
        text: '線性代數', fontSizePx: 48, color: '#ffffff', fontWeight: 700,
        fontFamily: 'heading', textAlign: 'left', lineHeight: 1.2,
      }],
    },
  });
  const match = /var textLayers = \[\];\s*try \{ textLayers = JSON\.parse\(base64ToUtf8\("([^"]*)"\)\)/.exec(doc);
  assert.ok(match, 'layers should be embedded');
  const decoded = JSON.parse(Buffer.from(match[1] ?? '', 'base64').toString('utf8')) as Array<{ id: string }>;
  assert.deepEqual(decoded.map((l) => l.id), ['l1']);
});

// ── deleting an element ────────────────────────────────────────────────────

test('withHiddenOverride deletes an element and puts it back, keeping its other tweaks', () => {
  const deleted = withHiddenOverride(undefined, true);
  assert.deepEqual(deleted, { hidden: true });
  // Un-deleting an element that has nothing else on it removes the entry entirely.
  assert.equal(withHiddenOverride(deleted ?? undefined, false), null);
  const styled = { text: '標題', styles: { color: '#fff' } };
  assert.deepEqual(withHiddenOverride(styled, true), { text: '標題', styles: { color: '#fff' }, hidden: true });
  assert.deepEqual(withHiddenOverride({ ...styled, hidden: true }, false), styled);
});

test('editing a deleted element does not silently undelete it', () => {
  // Both helpers rebuild the override from scratch, so anything they forget to carry is lost —
  // and "I changed its colour and it came back" is not a change anyone asked for.
  const deleted = { hidden: true } as const;
  assert.deepEqual(withStyleOverride(deleted, 'color', '#fff'), { styles: { color: '#fff' }, hidden: true });
  assert.deepEqual(withTextOverride(deleted, '新標題'), { text: '新標題', hidden: true });
});

test('the override list marks which entries are deletions', () => {
  // A deleted element cannot be clicked on the slide once inspect mode is off, so the list is the
  // only place left to find it.
  assert.match(describeOverride('0/1', { hidden: true }), /🗑/);
  assert.ok(!describeOverride('0/1', { text: 'x' }).includes('🗑'));
});

test('a deleted element is hidden by attribute, and stays visible while inspecting', () => {
  // Inline `display:none !important` could not be overridden by any stylesheet rule, so the
  // element would be unreachable — with no way to select it again and undo the deletion.
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: { ...defaultReactSlideConfig(), overrides: { '0/1': { hidden: true } } },
  });
  assert.match(doc, /\[data-ms-hidden="1"\] \{ display: none !important/);
  assert.match(doc, /body\.ms-inspect \[data-ms-hidden="1"\] \{ display: revert !important/);
  assert.match(doc, /el\.setAttribute\('data-ms-hidden', '1'\)/);
  // Re-applying overrides must clear the flag first, or an undeleted element would stay hidden.
  assert.match(doc, /el\.removeAttribute\('data-ms-hidden'\)/);
});

test('Del inside the sandbox is forwarded to the parent, which cannot see it otherwise', () => {
  // Clicking a slide element puts focus in the iframe; an opaque origin hides its key events from
  // the parent, so without this the key would do nothing exactly when a user would press it.
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
  });
  assert.match(doc, /ev\.key !== 'Delete'/);
  assert.match(doc, /ms-slide-delete-request/);
  // Never steal the key from a field being typed into.
  assert.match(doc, /tag === 'input' \|\| tag === 'textarea'/);
});

test('isSlideSandboxMessage accepts the delete request', () => {
  assert.ok(isSlideSandboxMessage({ type: 'ms-slide-delete-request' }));
});

test('the sandbox runtime is syntactically valid JavaScript', () => {
  // The runtime is written inside a template literal, so an unescaped backslash or backtick in it
  // ends a string early and the *whole* script fails to parse — the page then renders nothing at
  // all, with the background still showing, which reads as "the slide content disappeared".
  // This has now happened twice; parsing it here is the cheapest way for it not to happen again.
  const doc = buildReactSlideSandboxDoc({
    compiled: 'window.SlideComponent = function () { return null; };',
    theme: defaultSlideTheme(),
    config: {
      ...defaultReactSlideConfig(),
      overrides: { abc123: { text: 'x', styles: { color: '#fff' } } },
      textLayers: [{
        id: 'l1', xPct: 1, yPct: 1, widthPct: 10, heightPct: 10, text: 'x', fontSizePx: 20,
        color: '#fff', fontWeight: 400, fontFamily: 'body', textAlign: 'left', lineHeight: 1.2,
      }],
    },
  });
  const start = doc.lastIndexOf('<script>') + '<script>'.length;
  const script = doc.slice(start, doc.lastIndexOf('</script>'));
  assert.ok(script.trim().length > 0, 'the runtime script should not be empty');
  // Throws SyntaxError if the runtime is malformed; it is never called.
  assert.doesNotThrow(() => new Function(script));
});

test('the sandbox reports <br> breaks as newlines', () => {
  // Lifted text keeps its line breaks as <br>. textContent would drop them, so the panel would
  // show one run-on line and saving it would write that back — flattening the layout in one edit.
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
  });
  assert.match(doc, /tagName === 'BR'/);
  assert.match(doc, /out \+= '\\n';/);
});

test('MS_ASSET resolves only the assets the page actually has', () => {
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
    assetDataUrls: { 'asset-abcd1234.png': 'data:image/png;base64,AAAA' },
  });
  assert.match(doc, /window\.MS_ASSET = function/);
  // Inline, not an endpoint URL: the sandbox is an opaque origin, so a request it makes carries no
  // session cookie and the image would 403 — the same reason the background is painted outside it.
  assert.ok(
    doc.includes(btoa(JSON.stringify({ 'asset-abcd1234.png': 'data:image/png;base64,AAAA' }))),
    'the asset map should be embedded',
  );
  // An unknown name must resolve to '' rather than to a guessed URL.
  assert.match(doc, /hasOwnProperty\.call\(ASSETS, safe\) \? ASSETS\[safe\] : ''/);
});

test('the sandbox asks the parent to open links, because it is not allowed to itself', () => {
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
  });
  // No allow-popups and no allow-top-navigation, so an <a> would be blocked outright.
  assert.match(doc, /ms-slide-link/);
  assert.match(doc, /closest\('\[data-ms-href\]'\)/);
  // While inspect mode is on a click selects; leaving the page is not what the user means.
  assert.match(doc, /if \(!document\.body\.classList\.contains\('ms-inspect'\)\) \{/);
});

test('isOpenableSlideLink is the parent-side gate on what window.open may receive', () => {
  assert.equal(isOpenableSlideLink('https://example.com'), true);
  assert.equal(isOpenableSlideLink('http://example.com/a?b=1'), true);
  // The code can be hand-edited, so this check is what stops a deliberate payload, not a typo.
  assert.equal(isOpenableSlideLink('javascript:alert(1)'), false);
  assert.equal(isOpenableSlideLink('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isOpenableSlideLink('file:///etc/passwd'), false);
  assert.equal(isOpenableSlideLink('not a url'), false);
  assert.equal(isOpenableSlideLink(''), false);
});

test('the sandbox moves elements by dragging, and only ones the layout is not placing', () => {
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
    inspect: true,
  });
  assert.match(doc, /ms-slide-move/);
  // Only absolute/fixed: writing left/top onto a statically placed element does nothing, and a
  // drag that silently does nothing reads as a broken editor.
  assert.match(doc, /position === 'absolute' \|\| position === 'fixed'/);
  // A press that barely moves is still a click, so selecting an element does not nudge it.
  assert.match(doc, /DRAG_THRESHOLD/);
  // Arrow keys nudge; Shift makes it coarse.
  assert.match(doc, /ArrowLeft/);
  assert.match(doc, /ev\.shiftKey \? 10 : 1/);
});

test('dragging keeps the unit the element was already using', () => {
  const doc = buildReactSlideSandboxDoc({
    compiled: '',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
    inspect: true,
  });
  // A slide written in percentages should not come back in pixels because someone nudged it once.
  assert.match(doc, /if \(unit !== '%'\) return \{ value: Math\.round\(px\), unit: 'px' \}/);
  assert.match(doc, new RegExp(`axis === 'x' \\? ${SLIDE_CANVAS_WIDTH} : ${SLIDE_CANVAS_HEIGHT}`));
});

test('slideFitScale fits both axes, so a short container shrinks the slide instead of cropping it', () => {
  assert.equal(slideFitScale(SLIDE_CANVAS_WIDTH, SLIDE_CANVAS_HEIGHT), 1);
  // 1920×1080 viewport minus a 56px toolbar: the height is what runs out, not the width.
  assert.equal(slideFitScale(1920, 1024), 1024 / SLIDE_CANVAS_HEIGHT);
  // Taller than 16:9: the width runs out, and the extra height is just margin.
  assert.equal(slideFitScale(1680, 1200), 1680 / SLIDE_CANVAS_WIDTH);
  // No measured height yet (first paint) — fall back to width rather than to zero.
  assert.equal(slideFitScale(960, 0), 0.5);
});

test('slideFitScale never scales past 1:1, so a React page matches the image pages around it', () => {
  // An image page is an <img> with object-contain: it shrinks to fit but never enlarges beyond its
  // own pixels. On an ultrawide (32:9) a React page without this cap rendered a third larger than
  // every other page in the same deck — "the resolution is different, it's too big".
  assert.equal(slideFitScale(5120, 1440), 1);
  assert.equal(slideFitScale(3440, 1440), 1);
  assert.equal(slideFitScale(3840, 2160), 1);
  // Below 1:1 it still fits to the tighter axis.
  assert.equal(slideFitScale(1920, 1024), 1024 / SLIDE_CANVAS_HEIGHT);
});

test('the frame box may never be taller than the space it was given', () => {
  // Without this cap the box takes its height from its width via the aspect ratio and ignores the
  // available height, so a 16:9 screen with any toolbar cropped the slide on all four sides.
  assert.equal(slideFrameBoxStyle().maxHeight, '100%');
  // A caller that states a limit still wins — that is how the editor panel bounds the slide.
  assert.equal(slideFrameBoxStyle('60vh').maxHeight, '60vh');
  assert.equal(slideFrameBoxStyle().aspectRatio, `${SLIDE_CANVAS_WIDTH} / ${SLIDE_CANVAS_HEIGHT}`);
});
