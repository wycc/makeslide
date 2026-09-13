/**
 * The ordinary regeneration must leave step-built pages alone.
 *
 * A page imported from an animated pptx narrates from its manifest — one entry per step, one clip
 * each — while `runRegenerateScripts` / `runRegenerateAudio` know only about a page-level
 * `script.txt`. Running them on such a page is worse than a no-op: it writes a transcript the page
 * never speaks, and in doing so *replaces* the joined step text that exports, search and the tutor
 * read, so the deck starts saying one thing and showing another. The audio stage then records a
 * page-level clip the player ignores, whose duration is still counted in the deck's total.
 *
 * The distinction that matters here is manifest, not render type: most React pages are ordinary
 * pages drawn by code and must keep regenerating normally.
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

test('the script stage excludes them and refuses rather than silently doing nothing', () => {
  const start = SRC.indexOf('async function runRegenerateScripts(');
  const body = SRC.slice(start, SRC.indexOf('\nasync function', start + 10));
  assert.match(body, /const stepBuilt = stepBuiltPageNumbers\(pdfId, pageNumbers\)/);
  assert.match(body, /\.filter\(\(p\) => !stepBuilt\.has\(p\.page_number\)\)/);
  // Selecting only step-built pages must not report success having touched nothing.
  assert.match(body, /if \(pageRows\.length === 0\) \{[\s\S]{0,300}throw new Error/);
  assert.match(body, /逐步展開的頁面/, 'the message says what to use instead');
  // The exclusion happens before the transcripts are deleted, or the skip would still destroy them.
  const filterAt = body.indexOf('!stepBuilt.has(p.page_number)');
  const deleteAt = body.indexOf('fs.promises.rm(pageScriptPath');
  assert.ok(filterAt > 0 && deleteAt > filterAt, '必須在刪除既有逐字稿之前就排除，否則跳過也已經毀了它們');
});

test('the audio stage excludes them too, so no unplayed clip is recorded or counted', () => {
  const start = SRC.indexOf('async function runRegenerateAudio(');
  const body = SRC.slice(start, SRC.indexOf('\nasync function', start + 10));
  assert.match(body, /stepBuiltPageNumbers\(pdfId, pageNumbers\)/);
  assert.match(body, /\.filter\(\(s\) => !stepBuiltAudio\.has\(s\.pageNumber\)\)/);
  assert.match(body, /stepBuiltAudio\.size > 0[\s\S]{0,200}逐步展開的頁面/, 'the reason is distinguished from "no transcripts at all"');
});
