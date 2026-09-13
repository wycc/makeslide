/**
 * The ordinary regeneration has to route each page to the way it narrates.
 *
 * A page imported from an animated pptx narrates from its manifest — one entry per step, one clip
 * each — while `runRegenerateScripts` / `runRegenerateAudio` know only about a page-level
 * `script.txt`. Running them on such a page is worse than a no-op: it writes a transcript the page
 * never speaks, and in doing so *replaces* the joined step text that exports, search and the tutor
 * read, so the deck starts saying one thing and showing another. The audio stage then records a
 * page-level clip the player ignores, whose duration is still counted in the deck's total.
 *
 * So neither kind is refused: a selection that mixes them is ordinary, and failing it would make
 * the user run the job twice knowing which pages are which. Step-built pages go through the step
 * narration writer (text) and the per-step recorder (audio); everything else keeps the page-level
 * path.
 *
 * The distinction is the manifest, not the render type: most React pages are ordinary pages drawn
 * by code and must keep regenerating normally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../src/worker/regenerate.ts', import.meta.url)),
  'utf8',
);

test('the skip is decided by the step manifest, not by render_type', () => {
  const start = SRC.indexOf('function stepBuiltPageNumbers(');
  assert.ok(start > 0, 'regeneration knows which pages narrate per step');
  const body = SRC.slice(start, SRC.indexOf('\n}', start));
  assert.match(body, /readPageSteps\(pdfId, row\.page_uid\)\?\.steps\.length \?\? 0\) > 0/);
  // An ordinary React page (no manifest) narrates from script.txt like any other page; excluding
  // those by render type would stop their regeneration working at all.
  assert.doesNotMatch(body, /render_type/);
});

test('the script stage writes each kind its own way, and refuses neither', () => {
  const start = SRC.indexOf('async function runRegenerateScripts(');
  const body = SRC.slice(start, SRC.indexOf('\nasync function', start + 10));
  assert.match(body, /const stepBuilt = stepBuiltPageNumbers\(pdfId, pageNumbers\)/);
  // Page-level generation gets only the pages that narrate that way …
  assert.match(body, /\.filter\(\(p\) => !stepBuilt\.has\(p\.page_number\)\)/);
  // … and the rest go through the step narration writer, text only: the audio stage is what
  // records, and a script run that also spoke would charge for TTS nobody asked for here.
  assert.match(body, /narrateImportedDeck\(\{[\s\S]{0,200}pages: \[\.\.\.stepBuilt\][\s\S]{0,120}textOnly: true/);
  // A selection containing only step-built pages is a normal selection, not an error.
  assert.doesNotMatch(body, /throw new Error\('選到的頁面都是/);
  assert.match(body, /step\.total = pageRows\.length \+ stepBuilt\.size/, '進度要涵蓋兩種頁');
  // The page-level transcripts are deleted before generation; step-built pages must already be
  // out of that list, or the skip would have destroyed the very thing it protects.
  const filterAt = body.indexOf('!stepBuilt.has(p.page_number)');
  const deleteAt = body.indexOf('fs.promises.rm(pageScriptPath');
  assert.ok(filterAt > 0 && deleteAt > filterAt, '必須在刪除既有逐字稿之前就分流');
});

test('the audio stage records step pages per step, and the rest page by page', () => {
  const start = SRC.indexOf('async function runRegenerateAudio(');
  const body = SRC.slice(start, SRC.indexOf('\nasync function', start + 10));
  assert.match(body, /stepBuiltPageNumbers\(pdfId, pageNumbers\)/);
  // A page-level recording is never played by a step-built page, and its duration would still be
  // counted in the deck total — so those pages are taken out of the page-level batch …
  assert.match(body, /\.filter\(\(s\) => !stepBuiltAudio\.has\(s\.pageNumber\)\)/);
  // … and recorded per step instead.
  assert.match(body, /respeakPageSteps\(pdfId, pageNumber, uid/);
  assert.match(body, /step\.total = nonEmpty\.length \+ stepBuiltAudio\.size/);
  // Only "nothing at all to say" is an error now.
  assert.match(body, /nonEmpty\.length === 0 && stepBuiltAudio\.size === 0/);
});

test('respeaking says the existing words again rather than writing new ones', () => {
  const src = fs.readFileSync(
    fileURLToPath(new URL('../src/services/pptx/stepNarration.ts', import.meta.url)),
    'utf8',
  );
  const start = src.indexOf('export async function respeakPageSteps(');
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf('\n}', start));
  // "Regenerate audio" means say this again, not say something else.
  assert.doesNotMatch(body, /narrationLines|callChatJSON/);
  assert.match(body, /script: step\.script/);
  // Written per step, so an interrupted run keeps the clips it already made.
  assert.match(body, /writePageSteps\(pdfId, pageUid, \{ \.\.\.manifest, steps \}\);\s*\n\s*attempted \+= 1/);
});
