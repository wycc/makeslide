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
  assert.match(panel, /renarratePptxSteps\(pdfId, \{[\s\S]{0,200}pages: \[page\.page_number\][\s\S]{0,200}charsPerStep: chars/);
  // The hint goes with it, and only with it: it is never written to the deck's prompt.
  assert.match(panel, /instruction: hint\.trim\(\) \|\| undefined/);
  assert.match(panel, /setHint\(''\);/, 'a hint typed for one page must not carry to the next');
  // Storing the choice matters: otherwise the next rewrite silently reverts to the default.
  assert.match(panel, /updatePdfScriptSettings\(pdfId, scriptMaxCharsPerPage, undefined, chars\)/);
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

test('the deck setting reaches the panel, so the box is not always empty', () => {
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
    'play.stepNarration.charsLabel',
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
