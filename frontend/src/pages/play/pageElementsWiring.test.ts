import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source-level guards for the page element layer (docs/page-elements.md). These are the wires
 * whose loss is silent: a slide view that forgets the layer simply shows the base image bare, a
 * paste that goes back to replace-image quietly swaps the whole page, and an AI apply that forgets
 * `fuse` paints every element twice. None of those throw, so the tests read the source.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('every SlideRenderer that shows a page image also mounts the element layer', () => {
  const slidePanel = read('./PlayPageSlidePanel.tsx');
  const fullscreen = read('./PlayPageFullscreen.tsx');
  assert.equal((slidePanel.match(/<PageElementsLayer/g) ?? []).length, 1, 'slide panel mounts the layer once');
  assert.equal((fullscreen.match(/<PageElementsLayer/g) ?? []).length, 2, 'both fullscreen layouts mount the layer');
  // The layer must come before the drawing canvas so pen strokes paint on top of elements.
  const layerIdx = slidePanel.indexOf('<PageElementsLayer');
  const drawIdx = slidePanel.indexOf('<DrawingCanvas', slidePanel.indexOf('<SlideRenderer'));
  assert.ok(layerIdx > 0 && drawIdx > layerIdx, 'layer precedes the drawing canvas in the slide panel');
  // Only the slide panel is an editor; fullscreen shows elements read-only.
  assert.match(slidePanel, /editor=\{elementsEditing && !imageEditSelectMode \? elementsEditor : undefined\}/);
  for (const tag of fullscreen.match(/<PageElementsLayer[\s\S]*?\/>/g) ?? []) {
    assert.doesNotMatch(tag, /editor=/, 'fullscreen layers are read-only');
  }
});

test('the image under a layered page is the base image, chosen through slideImageUrlForPage', () => {
  const playPage = read('../PlayPage.tsx');
  assert.match(playPage, /slideImageUrlForPage\(currentPage, false, true\)/, 'playback src (thumbnail otherwise)');
  assert.match(playPage, /slideImageUrlForPage\(currentPage\)/, 'fullscreen src');
  assert.match(playPage, /slideImageUrlForPage\(page, false, !imageOnlyFullscreen\)/, 'preload list uses the same rule');
  assert.doesNotMatch(playPage, /currentPage\?\.thumbnail_url \?\? currentPage\?\.image_url/, 'no direct thumbnail/image fallback left');
});

test('pasted and dropped pictures go through handleIncomingImageFiles, never straight to replace-image', () => {
  const playPage = read('../PlayPage.tsx');
  const slidePanel = read('./PlayPageSlidePanel.tsx');
  assert.match(playPage, /await handleIncomingImageFiles\(\[fileFromItems\], currentPage\.page_number\)/, 'global paste');
  assert.match(playPage, /pasteTargetForPage\(currentPage\?\.render_type\)/, 'routing by page type');
  assert.match(playPage, /if \(elementsEditing\) \{[\s\S]*?addTextElement\(text\.slice\(0, 2000\)\)/, 'text paste becomes a text element while editing');
  assert.equal((slidePanel.match(/handleIncomingImageFiles\(/g) ?? []).length, 2, 'slide panel drop + paste both route');
  assert.doesNotMatch(slidePanel, /handleReplaceImageFile\(/, 'slide panel no longer calls replace-image directly');
});

test('applying an AI picture on a layered page fuses the layer and says so first', () => {
  const chat = read('./useChatAndImageEdit.ts');
  assert.match(chat, /replaceSlideImage\(pdfId, imagePreviewPageNumber, file, layered \? 'fuse' : 'base'\)/);
  const playPage = read('../PlayPage.tsx');
  assert.match(playPage, /t\('play\.elements\.fuseHint'\)/, 'preview dialog carries the fuse warning');
  const api = read('../../lib/api/pdfs.ts');
  // The server reads `mode` off the file part it awaits, so the field must be appended first.
  const modeIdx = api.indexOf("form.append('mode', mode)");
  const fileIdx = api.indexOf("form.append('file', file)", api.indexOf('export async function replaceSlideImage'));
  assert.ok(modeIdx > 0 && modeIdx < fileIdx, 'mode field precedes the file in the multipart body');
});

test('the elements tab exists, is wired to the editor, and the editor saves automatically', () => {
  const slidePanel = read('./PlayPageSlidePanel.tsx');
  assert.match(slidePanel, /setEditTab\('elements'\)/);
  assert.match(slidePanel, /editTab === 'elements' \? \(\s*<PageElementsTab \/>/);
  const hook = read('./usePageElements.ts');
  assert.match(hook, /const AUTOSAVE_DELAY_MS = 800;/);
  assert.match(hook, /elementsTabActive/);
  const playPage = read('../PlayPage.tsx');
  assert.match(playPage, /elementsTabActive: scriptEditorState\.editTab === 'elements'/);
  // Leaving the page with an unsaved draft flushes it for the page it belongs to, not the new one.
  assert.match(hook, /savePageElements\(previous\.pdfId, previous\.pageNumber, previousElements\)/);
});

test('the frontend and backend agree on the element vocabulary', () => {
  const front = read('../../lib/pageElements.ts');
  const back = fs.readFileSync(path.resolve(here, '../../../../backend/src/services/pageElements.ts'), 'utf8');
  const pick = (src: string, name: string) => {
    const m = new RegExp(`export const ${name} = \\[([^\\]]+)\\]`).exec(src);
    assert.ok(m, `${name} defined`);
    return m![1]!.replace(/\s/g, '');
  };
  assert.equal(pick(front, 'ELEMENT_FONT_FAMILIES'), pick(back, 'ELEMENT_FONT_FAMILIES'));
  assert.equal(pick(front, 'ELEMENT_SHAPES'), pick(back, 'ELEMENT_SHAPES'));
  const colorRe = (src: string) => /export const ELEMENT_COLOR_RE =\s*(\/.+\/);/.exec(src)?.[1];
  assert.equal(colorRe(front), colorRe(back), 'colour whitelist identical on both sides');
  assert.match(front, /ELEMENT_REF_HEIGHT = 1080/);
  assert.match(back, /ELEMENT_REF_HEIGHT = 1080/);
});
