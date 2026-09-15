/**
 * An imported pptx stays read-only until its narration exists, as a PDF or TXT deck does until its
 * audio is done.
 *
 * It used to be released the moment the pictures were rendered, with narration running behind it.
 * That opened the player on pages whose voice was still being recorded — a page heard mid-job had
 * half its steps voiced — and the editor on text the running narration was about to overwrite.
 *
 * The end-to-end path needs LibreOffice for minutes and a real model, so these pin the ordering
 * that decides the behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROUTE = fs.readFileSync(fileURLToPath(new URL('../src/routes/pdfs/pptx-import.ts', import.meta.url)), 'utf8');
const start = ROUTE.indexOf('function startImportJob(');
const JOB = ROUTE.slice(start, ROUTE.indexOf('\n}\n', start));

test('with narration requested, the deck is not released until the narration has run', () => {
  const branch = JOB.indexOf('if (narrateAsAccount) {');
  assert.ok(branch > 0, 'the import knows whether narration was asked for');
  const awaitAt = JOB.indexOf('await runNarrationJob(pdfId, narrateAsAccount', branch);
  const readyAt = JOB.indexOf("SET status = 'ready'", branch);
  assert.ok(awaitAt > branch, 'the narration is awaited, not fired off');
  assert.ok(readyAt > awaitAt, '語音全部完成之前不可以把簡報設成 ready');
  // Nothing before the branch may release it either.
  const beforeBranch = JOB.slice(0, branch);
  assert.doesNotMatch(beforeBranch, /SET status = 'ready'/, 'the pictures being done is not the deck being done');
});

test('the heartbeat spans the narration, or a long one is declared dead mid-job', () => {
  // The periodic rescan fails a processing pptx deck after minutes without a heartbeat. Stopping
  // the beat when the pictures are done would get a deck that is still narrating failed.
  const clearAt = JOB.indexOf('clearInterval(heartbeat)');
  const awaitAt = JOB.indexOf('await runNarrationJob(');
  // Both must exist: with no awaited narration indexOf returns -1 and any comparison passes.
  assert.ok(awaitAt > 0, 'the narration runs inside the import job, under its heartbeat');
  assert.ok(clearAt > awaitAt, 'the heartbeat is only cleared after the narration');
  assert.match(JOB, /finally \{\s*\n\s*clearInterval\(heartbeat\);/);
});

test('the card can show how far the narration has got', () => {
  assert.match(JOB, /progress_step = 'pptx_narrating'/);
  assert.match(JOB, /UPDATE pdfs SET progress_current = \?, progress_total = \?/);
});

test('a failed narration still releases a usable deck, and says what failed', () => {
  // Left `failed`, the deck would be read-only for good although its pages and pictures are fine
  // and the step panel can retry the narration.
  const branch = JOB.indexOf('if (narrateAsAccount) {');
  const tail = JOB.slice(branch);
  assert.match(tail, /narration\.status === 'failed' \? `旁白產生失敗：/);
  assert.doesNotMatch(tail.slice(0, tail.indexOf('} else {')), /status = 'failed'/);
});

test('without narration, the deck is released as soon as the import is done, as before', () => {
  const elseAt = JOB.indexOf('} else {', JOB.indexOf('if (narrateAsAccount) {'));
  assert.ok(elseAt > 0);
  assert.match(JOB.slice(elseAt, elseAt + 300), /SET status = 'ready'/);
});

test('the route still fires narration without waiting, so a manual rewrite does not lock the deck', () => {
  // Rewriting one page's narration from the step panel is an edit, not an import: the deck stays
  // usable while it runs, as a single-page regeneration does for a PDF.
  const route = ROUTE.indexOf("app.post('/api/pdfs/:id/pptx-narration'");
  const handler = ROUTE.slice(route, ROUTE.indexOf('app.get(', route));
  assert.match(handler, /startNarrationJob\(id, currentAccountId\(\)/);
  assert.doesNotMatch(handler, /await runNarrationJob/);
  assert.doesNotMatch(handler, /status = 'processing'/);
});
