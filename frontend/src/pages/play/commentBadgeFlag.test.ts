import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The deck carries a per-page "has comments" flag, and the slide badges are drawn from it.
 *
 * In fullscreen that same flag also decides whether the comments are fetched at all, so a page
 * whose first comment was written during the session showed no badge, fetched nothing, and looked
 * exactly like a page with nothing on it — until the deck was reloaded. Reported on a page whose
 * comment had been saved from the AI tutor panel minutes earlier.
 *
 * So every path that writes or removes a comment has to move the flag with it.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the flag lives on the deck and is what both badges read', () => {
  assert.match(read('./PlayPageSlidePanel.tsx'), /\{currentPage\.has_comment \? \(/, '一般畫面的 💬 徽章');
  const fullscreen = read('./PlayPageFullscreen.tsx');
  assert.match(fullscreen, /\{currentPage\?\.has_comment \? \(/, '全螢幕的 💬 徽章');
  // The gate that made a stale flag invisible rather than merely wrong.
  assert.match(fullscreen, /const hasPageComments = !!currentPage\?\.has_comment;/);
  assert.match(fullscreen, /useFullscreenPageComments\(\s*\n\s*pdfId,\s*\n\s*currentPage\?\.page_number \?\? null,\s*\n\s*hasPageComments,/);
});

test('writing a comment turns the flag on, wherever it was written', () => {
  const setter = /setPageHasComment\((currentPage\.page_number|[^,]+), true\)/;
  assert.match(read('./PageAskPanel.tsx'), setter, '把導師問答存成評論的路徑');
  assert.match(read('./PlayPageSidebar.tsx'), setter, '側邊欄自己寫評論的路徑');
});

test('removing the last comment turns it off again', () => {
  const sidebar = read('./PlayPageSidebar.tsx');
  const del = sidebar.slice(sidebar.indexOf('const handleDelete ='), sidebar.indexOf('const handleSaveEdit ='));
  assert.match(del, /setPageHasComment\(currentPage\.page_number, next\.length > 0\)/, '刪到剩零則就要關掉旗標');
});

test('the flag is patched on the deck itself, not kept somewhere the badges cannot see', () => {
  const playPage = read('../PlayPage.tsx');
  const fn = playPage.slice(playPage.indexOf('const setPageHasComment = useCallback('));
  assert.match(fn.slice(0, 500), /p\.page_number === pageNumber \? \{ \.\.\.p, has_comment: has \}/);
  assert.match(playPage, /setPageHasComment,/, '要放進 context 才用得到');
});
