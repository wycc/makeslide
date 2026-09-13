import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../../locales/zh-TW';
import { en } from '../../locales/en';

/**
 * Source-level guards for editing the narration of a step-built page.
 *
 * The transcript box writes the page-level script, which such a page never speaks — its words live
 * in the manifest, one clip per step. So the transcript tab has to *replace* itself on these pages
 * rather than sit next to the real editor, and every save has to go through the per-step route,
 * which re-records the clip. A save that only changed the text would leave the page saying one
 * thing and showing another, which is the failure this whole panel exists to prevent.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the transcript tab swaps to the step panel on a step-built page', () => {
  const panel = read('./PlayPageSlidePanel.tsx');
  assert.match(panel, /editTab === 'script' && stepCount > 0 && pdfId && currentPage \? \(/);
  // …and the ordinary editor is the other branch, not something rendered alongside it.
  assert.match(panel, /\) : editTab === 'script' \? \(/);
  assert.match(panel, /<StepNarrationPanel[\s\S]{0,400}onChanged=\{reloadDetail\}/);
});

test('saving a step goes through the per-step route, which re-records it', () => {
  const api = read('../../lib/api/pdfs.ts');
  assert.match(api, /export async function savePageStepScript/);
  assert.match(api, /\/pages\/\$\{pageNumber\}\/steps\/\$\{stepIndex\}\/script/);
  assert.match(api, /method: 'PUT'/);
  // voice defaults to on: the body only carries the flag when the caller opts out.
  assert.match(api, /\.\.\.\(opts\.voice === false \? \{ voice: false \} : \{\}\)/);

  const panel = read('./StepNarrationPanel.tsx');
  assert.match(panel, /savePageStepScript\(pdfId, page\.page_number, index, valueOf\(index\), \{ voice \}\)/);
  // A failed voice must not read as a failed save — the words are stored either way.
  assert.match(panel, /if \(result\.voice_error\)/);
  assert.match(panel, /play\.stepNarration\.savedTextOnly/, 'text-only saves say the voice is now stale');
});

test('the AI rewrite targets this page only, and remembers the length', () => {
  const panel = read('./StepNarrationPanel.tsx');
  assert.match(panel, /renarratePptxSteps\(pdfId, \{[\s\S]{0,300}pages: \[page\.page_number\]/);
  // Three intents, and the number is a page total rather than a per-step length: a five-step page
  // was being given five pages' worth of narration when they were confused.
  assert.match(panel, /charsPerPage: chars/);
  assert.match(panel, /keepLengths: lengthMode === 'keep'/);
  assert.match(panel, /'deck' \| 'page' \| 'keep'/);
  // The hint goes with it, and only with it: it is never written to the deck's prompt.
  assert.match(panel, /instruction: hint\.trim\(\) \|\| undefined/);
  assert.match(panel, /setHint\(''\);/, 'a hint typed for one page must not carry to the next');
  // A one-off: "make this page longer just now" is not "make every page longer from now on", so
  // the deck's own setting is left alone.
  assert.doesNotMatch(panel, /updatePdfScriptSettings/);
  assert.match(panel, /fetchPptxImportStatus\(pdfId\)/, 'the job is asynchronous, so progress is polled');
  const api = read('../../lib/api/pdfs.ts');
  assert.match(api, /export async function renarratePptxSteps/);
  assert.match(api, /pptx-narration/);
});

test('the panel watches the page fill in instead of waiting for the job to end', () => {
  const panel = read('./StepNarrationPanel.tsx');
  // Polled alongside the status: the words land when they are written and each clip when it is
  // recorded, so a 24-step page would otherwise sit unchanged for minutes and then arrive whole.
  assert.match(panel, /fetchPageSteps\(pdfId, page\.page_number\)/);
  assert.match(panel, /if \(live\?\.steps\?\.length\) setLiveSteps\(live\.steps\)/);
  assert.match(panel, /const steps = liveSteps \?\? page\.steps \?\? \[\]/);
  // And the live copy is dropped once the canonical detail arrives, so the two cannot disagree.
  assert.match(panel, /setLiveSteps\(null\);\s*\n\s*await onChanged\(\)/);
  const api = read('../../lib/api/pdfs.ts');
  assert.match(api, /export async function fetchPageSteps/);
  assert.match(api, /\/pages\/\$\{pageNumber\}\/steps`/);
});

test('the deck still exposes its per-step override, for the advanced case', () => {
  const types = read('../../types.ts');
  assert.match(types, /script_chars_per_step\?: number \| null;/);
  const shared = read('../../../../backend/src/routes/pdfs/shared.ts');
  assert.match(shared, /script_chars_per_step: row\.script_chars_per_step \?\? null,/);
});

test('fullscreen does not offer an edit that the page would never speak', () => {
  const fullscreen = read('./PlayPageFullscreen.tsx');
  // The same trap as the transcript tab: this box edits the page-level script, which a step-built
  // page never plays. Read-only rather than hidden — the joined words are still worth reading.
  assert.match(fullscreen, /disabled=\{isReadOnlyProcessing \|\| stepCount > 0\}/);
  assert.match(fullscreen, /readOnly=\{stepCount > 0\}/);
  assert.match(fullscreen, /play\.fullscreen\.stepTranscriptReadOnly/, 'and it says where the editable version is');
});

test('both locales carry every panel string', () => {
  const keys = [
    'play.stepNarration.intro',
    'play.stepNarration.lengthModeLabel',
    'play.stepNarration.lengthModeDeck',
    'play.stepNarration.lengthModePage',
    'play.stepNarration.lengthModeKeep',
    'play.stepNarration.lengthHintBudget',
    'play.stepNarration.lengthHintKeep',
    'play.stepNarration.rewritePage',
    'play.stepNarration.rewriteHint',
    'play.stepNarration.stepLabel',
    'play.stepNarration.hasVoice',
    'play.stepNarration.noVoice',
    'play.stepNarration.saveAndVoice',
    'play.stepNarration.saveTextOnly',
    'play.stepNarration.savedTextOnly',
    'play.stepNarration.voiceFailed',
    'play.stepNarration.unsaved',
  ] as const;
  for (const key of keys) {
    for (const [name, locale] of [['zh-TW', zhTW], ['en', en]] as const) {
      const value = (locale as Record<string, string | undefined>)[key];
      assert.equal(typeof value, 'string', `${name} is missing ${key}`);
      assert.notEqual((value ?? '').trim(), '');
    }
  }
});

test('arrow keys walk a step-built page and turn the page past the last step', () => {
  const playPage = read('../PlayPage.tsx');
  const start = playPage.indexOf("ev.key === 'ArrowLeft' || ev.key === 'ArrowRight'");
  assert.ok(start > 0);
  const block = playPage.slice(start, playPage.indexOf("ev.key === 'ArrowUp'", start));
  // The step check comes before the page turn, or ←/→ would leave the page mid-build …
  assert.match(block, /if \(stepCount > 0 && !ev\.shiftKey\) \{[\s\S]{0,300}stepPageAction\(currentStep, stepCount, direction\)/);
  // … and before the GSAP presenter branch, which knows nothing about page steps and would just
  // turn the page.
  const stepAt = block.indexOf('stepPageAction(');
  const presenterAt = block.indexOf('presenterStepAction(');
  assert.ok(stepAt > 0 && presenterAt > stepAt, '分步頁的判斷要排在一般動畫的判斷之前');
  // Shift is the escape hatch that still turns the page directly.
  assert.match(block, /if \(direction === 1\) goNext\(\);/);
  // The handler has to see the current step, or it would always act as if on the first one.
  assert.match(playPage, /bookmarks, currentPage, stepCount, currentStep\]\)/);
});

test('up/down still stop at the ends, which is how one sits on the last step', () => {
  const playPage = read('../PlayPage.tsx');
  const start = playPage.indexOf("ev.key === 'ArrowUp' || ev.key === 'ArrowDown'");
  const block = playPage.slice(start, start + 900);
  assert.match(block, /Math\.min\(Math\.max\(step \+ delta, 0\), stepCount - 1\)/);
  assert.doesNotMatch(block, /goNext\(\)|goPrev\(\)/, '↑/↓ 不該翻頁——那是 ←/→ 的事');
});
