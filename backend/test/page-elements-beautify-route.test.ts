/**
 * The beautify endpoint's order of operations, which is what makes the feature safe to press.
 *
 * The page is rewritten in two places (its base picture and its element layer) by two calls that
 * can each fail on their own. The rules below are the difference between "a button that tidies the
 * page" and "a button that might eat it", and none of them is visible in a type.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROUTE = fs.readFileSync(fileURLToPath(new URL('../src/routes/pdfs/page-elements.ts', import.meta.url)), 'utf8');
const start = ROUTE.indexOf("app.post('/api/pdfs/:id/pages/:n/elements/beautify'");
const BEAUTIFY = ROUTE.slice(start, ROUTE.indexOf("app.post('/api/pdfs/:id/pages/:n/elements/beautify/undo'"));
const UNDO = ROUTE.slice(
  ROUTE.indexOf("app.post('/api/pdfs/:id/pages/:n/elements/beautify/undo'"),
  ROUTE.indexOf("app.post('/api/pdfs/:id/pages/:n/elements/assets'"),
);

test('nothing is rewritten before the page has been snapshotted', () => {
  assert.ok(start > 0, 'the endpoint exists');
  const snapshotAt = BEAUTIFY.indexOf('beautifyUndoElementsPath(id, pageUid), JSON.stringify(');
  const backgroundAt = BEAUTIFY.indexOf('replacePageBaseImage(');
  const saveAt = BEAUTIFY.indexOf('savePageElements(');
  assert.ok(snapshotAt > 0, '先存還原點');
  assert.ok(backgroundAt > snapshotAt && saveAt > snapshotAt, '換背景與寫入排版都必須在還原點之後');
  // A snapshot that cannot be written stops the whole thing, rather than leaving no way back.
  assert.match(BEAUTIFY, /'無法建立還原點，已中止'/);
});

test('the new picture goes under the elements, never through them', () => {
  // `fusePageElements` is the other path: it bakes the elements into the picture. Using it here
  // would destroy exactly what this feature promises to keep.
  assert.match(BEAUTIFY, /replacePageBaseImage\(\{ pdfId: id, pageNumber: n, pageUid \}, jpeg/);
  assert.doesNotMatch(BEAUTIFY, /fusePageElements/, '美化不可以把元素烤進圖片');
  // The picture is fitted to the deck's canvas before it becomes a base, or the elements'
  // fractional boxes would land somewhere else entirely.
  assert.match(BEAUTIFY, /\.resize\(CANVAS\.width, CANVAS\.height/);
});

test('each half degrades on its own', () => {
  // The background call is the slow, flaky one (an image model). Its failure must leave the layout
  // pass to run on the picture the page already has.
  const bgCatch = BEAUTIFY.slice(BEAUTIFY.indexOf('background generation failed'));
  assert.match(bgCatch, /warnings\.push\(/, '背景失敗只是警告');
  assert.doesNotMatch(bgCatch.slice(0, 400), /return reply\.code\(5/, '背景失敗不可以中斷整個請求');
  const layoutCatch = BEAUTIFY.slice(BEAUTIFY.indexOf('layout proposal failed'));
  assert.match(layoutCatch, /laidOut = elements;/, '排版失敗就保留原本的元素');
});

test('a page with no elements is refused rather than half-beautified', () => {
  assert.match(BEAUTIFY, /elements\.length === 0[\s\S]{0,200}'NO_ELEMENTS'/);
  // React/notebook pages have no base image to place anything on, as with the PUT.
  assert.match(BEAUTIFY, /render_type === 'react' \|\| found\.page\.render_type === 'notebook'/);
});

test('undo puts back both halves, once', () => {
  assert.match(UNDO, /replacePageBaseImage\(/, '背景要還原');
  assert.match(UNDO, /savePageElements\(/, '元素也要還原');
  const restoreAt = UNDO.indexOf('savePageElements(');
  const removeAt = UNDO.indexOf('fs.promises.rm(beautifyUndoElementsPath');
  assert.ok(removeAt > restoreAt, '先還原、再丟掉還原點');
  assert.match(UNDO, /'NO_UNDO'/, '沒有還原點時要講清楚，而不是假裝成功');
});

test('the editor can tell whether there is anything to undo', () => {
  assert.match(ROUTE, /has_beautify_undo: hasBeautifyUndo\(id, found\.page\.page_uid\)/, 'GET 要回報');
  assert.match(BEAUTIFY, /has_beautify_undo: true/);
  assert.match(UNDO, /has_beautify_undo: false/);
});
