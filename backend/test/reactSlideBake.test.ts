import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBakeDocument } from '../src/services/reactSlideBake';
import { defaultReactSlideConfig, defaultSlideTheme, EDITABLE_CSS_PROPERTIES } from '../src/services/reactSlide';

/**
 * The baked JPG is what every export ships, so what matters is that the baking document renders
 * the same thing the viewer sees: the theme, the background, and the user's per-element overrides.
 * A bake that quietly dropped any of those would produce a handout that disagrees with the screen.
 */

function baseInput() {
  return {
    compiled: 'window.SlideComponent = function () { return null; };',
    theme: defaultSlideTheme(),
    config: defaultReactSlideConfig(),
    backgroundDataUrl: null,
    reactSource: '/* react */',
    reactDomSource: '/* react-dom */',
  };
}

test('the baking document lays out the same 1920x1080 canvas as the viewer', () => {
  const doc = buildBakeDocument(baseInput());
  assert.match(doc, /width: 1920px; height: 1080px/);
  assert.match(doc, /--slide-accent: #38bdf8;/);
});

test('the baking document inlines React rather than fetching it', () => {
  // setContent has no origin to resolve a URL against, and an air-gapped host has no CDN.
  const doc = buildBakeDocument({ ...baseInput(), reactSource: 'REACT_UMD_HERE', reactDomSource: 'REACT_DOM_UMD_HERE' });
  assert.match(doc, /REACT_UMD_HERE/);
  assert.match(doc, /REACT_DOM_UMD_HERE/);
  assert.equal(doc.includes('<script src='), false);
});

test('the baking document carries the overrides, so exports match what was edited on screen', () => {
  const doc = buildBakeDocument({
    ...baseInput(),
    config: {
      ...defaultReactSlideConfig(),
      overrides: { '0/1': { text: '改過的文字', styles: { color: '#0cd4ac' } } },
    },
  });
  const match = /JSON\.parse\(base64ToUtf8\("([^"]*)"\)\) \|\| \{\}/.exec(doc);
  assert.ok(match, 'overrides should be embedded');
  const decoded = JSON.parse(Buffer.from(match[1] ?? '', 'base64').toString('utf8')) as Record<string, unknown>;
  assert.deepEqual(decoded, { '0/1': { text: '改過的文字', styles: { color: '#0cd4ac' } } });
  assert.match(doc, /setProperty\(kebab, styles\[prop\], 'important'\)/);
});

test('the baking document applies the same CSS whitelist as the editor', () => {
  const doc = buildBakeDocument(baseInput());
  const match = /var EDITABLE = JSON\.parse\(base64ToUtf8\("([^"]*)"\)\)/.exec(doc);
  assert.ok(match, 'whitelist should be embedded');
  const decoded = JSON.parse(Buffer.from(match[1] ?? '', 'base64').toString('utf8')) as string[];
  assert.deepEqual(decoded, [...EDITABLE_CSS_PROPERTIES]);
});

test('a colour background paints, and the body stops painting its own', () => {
  const doc = buildBakeDocument({
    ...baseInput(),
    config: { ...defaultReactSlideConfig(), background: { mode: 'color', color: '#123456' } },
  });
  assert.match(doc, /background-color: #123456;/);
  assert.match(doc, /body \{ background: transparent;/);
});

test('an image background is embedded as data, since the bake has no session to fetch with', () => {
  const doc = buildBakeDocument({
    ...baseInput(),
    config: { ...defaultReactSlideConfig(), background: { mode: 'image', fit: 'contain', overlayOpacity: 0.6 } },
    backgroundDataUrl: 'data:image/png;base64,AAAA',
  });
  assert.match(doc, /background-image: url\("data:image\/png;base64,AAAA"\)/);
  assert.match(doc, /background-size: contain;/);
  assert.match(doc, /opacity: 0\.6;/);
});

test('an unsafe theme token falls back instead of reaching the renderer', () => {
  const theme = defaultSlideTheme();
  theme.tokens['--slide-bg'] = 'url(https://evil.example/x.png)';
  const doc = buildBakeDocument({ ...baseInput(), theme });
  assert.equal(doc.includes('evil.example'), false);
  assert.match(doc, /--slide-bg: #0f172a;/);
});

test('the document waits for React to commit before declaring itself ready', () => {
  // React 18 commits asynchronously; screenshotting on the first frame catches an empty page.
  const doc = buildBakeDocument(baseInput());
  assert.match(doc, /window\.__msSlideReady = true/);
  assert.match(doc, /root\.children\.length === 0/);
});

test('the bake document carries none of the inspector machinery', () => {
  const doc = buildBakeDocument(baseInput());
  // A picture has no use for click-to-select, and its hover outline would be baked into the JPG.
  assert.equal(doc.includes('ms-inspect'), false);
  assert.equal(doc.includes('ms-slide-select'), false);
  assert.equal(doc.includes('postMessage'), false);
});
