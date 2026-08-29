import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLIDE_THEME_TOKENS,
  MAX_OVERRIDE_ENTRIES,
  buildBackgroundImagePrompt,
  buildReactSlideMessages,
  compileReactSlide,
  defaultReactSlideCode,
  defaultSlideTheme,
  extractJsxFromLlmOutput,
  findReactSlideContractIssue,
  findUnsafeReactSlideCode,
  isSafeCssValue,
  normalizeStyleOverrides,
  parseStoredReactSlideConfig,
  parseStoredSlideTheme,
  sanitizeReactSlideConfig,
  sanitizeSlideTheme,
  validateAndCompileReactSlide,
} from '../src/services/reactSlide';

// ── code safety ────────────────────────────────────────────────────────────

test('findUnsafeReactSlideCode rejects network, eval and frame-escape APIs', () => {
  assert.equal(findUnsafeReactSlideCode('const r = fetch("/api/pdfs")'), 'fetch');
  assert.equal(findUnsafeReactSlideCode('new WebSocket("wss://x")'), 'WebSocket');
  assert.equal(findUnsafeReactSlideCode('eval("1+1")'), 'eval');
  assert.equal(findUnsafeReactSlideCode('window.parent.location = "/"'), 'window.parent');
  assert.equal(findUnsafeReactSlideCode('localStorage.getItem("token")'), 'localStorage');
});

test('findUnsafeReactSlideCode rejects ES module syntax a JSX file might carry', () => {
  assert.equal(findUnsafeReactSlideCode('import React from "react";\nfunction Slide() {}'), 'import');
  assert.equal(findUnsafeReactSlideCode('export default function Slide() {}'), 'export');
});

test('findUnsafeReactSlideCode accepts an ordinary slide component', () => {
  assert.equal(findUnsafeReactSlideCode(defaultReactSlideCode()), null);
});

test('findReactSlideContractIssue requires the window.SlideComponent export', () => {
  assert.equal(findReactSlideContractIssue(defaultReactSlideCode()), null);
  assert.match(
    findReactSlideContractIssue('function Slide() { return null; }') ?? '',
    /window\.SlideComponent/,
  );
});

// ── compilation ────────────────────────────────────────────────────────────

test('compileReactSlide turns JSX into React.createElement calls', async () => {
  const compiled = await compileReactSlide('function Slide() { return <div>hi</div>; }\nwindow.SlideComponent = Slide;');
  assert.match(compiled.code, /React\.createElement\("div"/);
  assert.match(compiled.code, /window\.SlideComponent = Slide/);
});

test('validateAndCompileReactSlide reports syntax errors instead of storing broken code', async () => {
  const result = await validateAndCompileReactSlide('function Slide() { return <div>; }\nwindow.SlideComponent = Slide;');
  assert.equal(result.ok, false);
  assert.ok((result.message ?? '').length > 0);
});

test('validateAndCompileReactSlide rejects empty code and disallowed APIs before compiling', async () => {
  assert.equal((await validateAndCompileReactSlide('   ')).ok, false);
  const unsafe = await validateAndCompileReactSlide('function Slide(){ fetch("/x"); }\nwindow.SlideComponent = Slide;');
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.message ?? '', /fetch/);
});

test('validateAndCompileReactSlide accepts the default skeleton', async () => {
  const result = await validateAndCompileReactSlide(defaultReactSlideCode());
  assert.equal(result.ok, true);
  assert.ok((result.compiled ?? '').includes('React.createElement'));
});

// ── LLM output extraction ──────────────────────────────────────────────────

test('extractJsxFromLlmOutput pulls code out of a fenced block', () => {
  const output = '這是投影片：\n```jsx\nfunction Slide() { return null; }\n```\n希望有幫助。';
  assert.equal(extractJsxFromLlmOutput(output), 'function Slide() { return null; }');
});

test('extractJsxFromLlmOutput falls back to the raw reply when unfenced', () => {
  assert.equal(extractJsxFromLlmOutput('  function Slide() {}  '), 'function Slide() {}');
});

// ── CSS overrides ──────────────────────────────────────────────────────────

test('isSafeCssValue rejects values that reach outside the sandbox or break out of the rule', () => {
  assert.equal(isSafeCssValue('#ff0000'), true);
  assert.equal(isSafeCssValue('url(https://evil.example/x.png)'), false);
  assert.equal(isSafeCssValue('red; background: url(x)'), false);
  assert.equal(isSafeCssValue('expression(alert(1))'), false);
  assert.equal(isSafeCssValue('javascript:alert(1)'), false);
  assert.equal(isSafeCssValue('a'.repeat(500)), false);
  assert.equal(isSafeCssValue(''), false);
});

test('normalizeStyleOverrides keeps whitelisted properties and drops everything else', () => {
  const styles = normalizeStyleOverrides({
    color: ' #fff ',
    'font-size': '48px',
    'background-image': 'url(x)',
    // Placement is editable since text lifted off the background became a real element.
    position: 'absolute',
    animation: 'spin 1s',
    opacity: 0.5 as unknown as string,
  });
  assert.deepEqual(styles, { color: '#fff', 'font-size': '48px', position: 'absolute' });
});

// ── config ─────────────────────────────────────────────────────────────────

test('a deleted element is an override in its own right', () => {
  // `hidden` alone has to survive: deleting an element the user never styled would otherwise be
  // dropped as an "empty" override, and the element would come back on the next load.
  const config = sanitizeReactSlideConfig({
    version: 1,
    overrides: {
      '0/1': { hidden: true },
      '0/2': { hidden: true, styles: { color: '#fff' } },
      '0/3': { hidden: false },
      '0/4': { hidden: 'yes' },
    },
  });
  assert.deepEqual(config.overrides['0/1'], { hidden: true });
  assert.deepEqual(config.overrides['0/2'], { styles: { color: '#fff' }, hidden: true });
  // hidden:false is not a tweak, so the entry has nothing in it and is dropped.
  assert.equal(config.overrides['0/3'], undefined);
  // Anything that is not a boolean is not a deletion — no truthiness games on stored data.
  assert.equal(config.overrides['0/4'], undefined);
});

test('sanitizeReactSlideConfig keeps valid element paths and drops malformed ones', () => {
  const config = sanitizeReactSlideConfig({
    version: 1,
    overrides: {
      '0/2/1': { text: '標題', styles: { color: '#fff', 'z-index': '2' } },
      'body > h1': { text: 'nope' },
      '0/../1': { text: 'nope' },
      '1': { styles: { animation: 'spin 1s' } },
    },
    background: { mode: 'color', color: '#101010' },
  });
  assert.deepEqual(Object.keys(config.overrides), ['0/2/1']);
  assert.deepEqual(config.overrides['0/2/1'], { text: '標題', styles: { color: '#fff', 'z-index': '2' } });
  assert.equal(config.background.mode, 'color');
  assert.equal(config.background.color, '#101010');
});

test('sanitizeReactSlideConfig caps how many overrides one page can carry', () => {
  const overrides: Record<string, { text: string }> = {};
  for (let i = 0; i < MAX_OVERRIDE_ENTRIES + 20; i += 1) overrides[String(i)] = { text: `t${i}` };
  const config = sanitizeReactSlideConfig({ version: 1, overrides, background: { mode: 'none' } });
  assert.equal(Object.keys(config.overrides).length, MAX_OVERRIDE_ENTRIES);
});

test('parseStoredReactSlideConfig falls back to defaults for unreadable JSON', () => {
  const config = parseStoredReactSlideConfig('{ not json');
  assert.deepEqual(config.overrides, {});
  assert.equal(config.background.mode, 'none');
});

test('sanitizeReactSlideConfig rejects an unsafe background color', () => {
  const config = sanitizeReactSlideConfig({
    version: 1,
    overrides: {},
    background: { mode: 'color', color: 'url(https://evil.example/x)' },
  });
  assert.equal(config.background.color, undefined);
});

// ── theme ──────────────────────────────────────────────────────────────────

test('sanitizeSlideTheme keeps only known tokens and falls back per-token', () => {
  const theme = sanitizeSlideTheme({
    version: 1,
    name: 'Ocean',
    tokens: {
      '--slide-accent': '#00b4d8',
      '--slide-bg': 'url(https://evil.example/bg.png)',
      '--evil': 'anything',
    },
  });
  assert.equal(theme.name, 'Ocean');
  assert.equal(theme.tokens['--slide-accent'], '#00b4d8');
  // unsafe value → keeps the default rather than the submitted one
  assert.equal(theme.tokens['--slide-bg'], DEFAULT_SLIDE_THEME_TOKENS['--slide-bg']);
  assert.equal((theme.tokens as Record<string, string>)['--evil'], undefined);
});

test('sanitizeSlideTheme drops custom CSS that could pull in external resources', () => {
  assert.equal(sanitizeSlideTheme({ tokens: {}, customCss: '@import url(https://evil.example/x.css);' }).customCss, undefined);
  assert.equal(sanitizeSlideTheme({ tokens: {}, customCss: 'h1 { letter-spacing: 2px; }' }).customCss, 'h1 { letter-spacing: 2px; }');
});

test('parseStoredSlideTheme returns the default theme for a corrupted file', () => {
  assert.deepEqual(parseStoredSlideTheme('nope').tokens, defaultSlideTheme().tokens);
});

// ── prompts ────────────────────────────────────────────────────────────────

test('buildReactSlideMessages includes the theme tokens and the page transcript', () => {
  const messages = buildReactSlideMessages({
    prompt: '做一頁封面',
    pageScript: '大家好，今天要談的是分散式系統。',
    theme: defaultSlideTheme(),
  });
  assert.equal(messages.length, 2);
  assert.match(String(messages[0]?.content), /--slide-accent/);
  assert.match(String(messages[0]?.content), /window\.SlideComponent/);
  assert.match(String(messages[1]?.content), /分散式系統/);
});

test('buildBackgroundImagePrompt forbids text and mentions the theme palette', () => {
  const prompt = buildBackgroundImagePrompt('海邊的日出', defaultSlideTheme());
  assert.match(prompt, /no text/i);
  assert.match(prompt, /海邊的日出/);
  assert.match(prompt, new RegExp(DEFAULT_SLIDE_THEME_TOKENS['--slide-accent']));
});
