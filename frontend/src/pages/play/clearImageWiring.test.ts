import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source-level guards for "clear image" (the button that makes the next AI redraw ignore the
 * current picture). Like the element-layer wires, these fail silently if they come undone: a
 * button that stops reloading the deck leaves a picture on screen the server already deleted, and
 * a cleared picture that is not posted back into the chat is simply unrecoverable from the UI.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the clear-image button asks first, reloads the deck, and offers the old picture back', () => {
  const chat = read('./useChatAndImageEdit.ts');
  assert.match(chat, /window\.confirm\(t\('play\.sidebar\.qa\.clearImageConfirm'\)\)/, 'destructive, so it confirms');
  assert.match(chat, /await clearSlideImage\(pdfId, pageNumberAtSend\)/);
  assert.match(chat, /await reloadDetail\(\)/, 'the page must stop showing the deleted picture');
  // The cleared picture comes back as a chat image message — that is the only way to re-apply it.
  assert.match(chat, /res\.candidate_image_url[\s\S]*?\$\{IMAGE_MSG_PREFIX\}\$\{res\.candidate_image_url\}/);
});

test('the button only appears on a page that has a picture, and never while read-only', () => {
  const sidebar = read('./PlayPageSidebar.tsx');
  assert.match(sidebar, /!isReadOnlyProcessing && currentPage\?\.image_url && \([\s\S]{0,600}?handleClearImage\(\)/);
  assert.match(sidebar, /t\('play\.sidebar\.qa\.clearImage'\)/);
});

test('a finished deck with no picture says so instead of claiming one is being generated', () => {
  for (const file of ['./PlayPageSlidePanel.tsx', './PlayPageFullscreen.tsx']) {
    const src = read(file);
    const readyIdx = src.indexOf("detail?.status === 'ready'");
    assert.ok(readyIdx > 0, `${file}: ready decks get their own placeholder`);
    assert.match(src.slice(readyIdx, readyIdx + 200), /play\.slidePanel\.noImage/);
  }
});

test('both locales carry every clear-image string the UI asks for', () => {
  const keys = [
    'play.sidebar.qa.clearImage',
    'play.sidebar.qa.clearImageTitle',
    'play.sidebar.qa.clearImageConfirm',
    'play.sidebar.qa.clearImageChatUser',
    'play.sidebar.qa.clearImageChatDone',
    'play.sidebar.qa.clearImageChatNothing',
    'play.sidebar.qa.clearImageFailed',
    'play.slidePanel.noImage',
  ];
  for (const locale of ['../../locales/zh-TW.ts', '../../locales/en.ts']) {
    const src = read(locale);
    for (const key of keys) assert.ok(src.includes(`'${key}'`), `${locale} is missing ${key}`);
  }
});
