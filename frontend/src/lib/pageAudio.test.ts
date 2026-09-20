import test from 'node:test';
import assert from 'node:assert/strict';
import { playablePageAudioUrl, playableStepAudioUrl, spokenScriptFor } from './pageAudio';
import { buildSentenceTimeline, splitScriptIntoSentences } from './subtitles';
import type { PdfDetailPage } from '../types';

test('playablePageAudioUrl returns the audio_url for ordinary image pages', () => {
  assert.equal(playablePageAudioUrl({ audio_url: '/a/1.mp3', render_type: 'static-image' }), '/a/1.mp3');
  assert.equal(playablePageAudioUrl({ audio_url: '/a/2.mp3', render_type: 'gsap-image' }), '/a/2.mp3');
  // render_type omitted (legacy rows) still counts as playable
  assert.equal(playablePageAudioUrl({ audio_url: '/a/3.mp3' }), '/a/3.mp3');
});

test('playablePageAudioUrl treats notebook pages as silent even when an audio_url lingers', () => {
  // A page converted to notebook keeps its old audio_url in the DB/detail; it must not load.
  assert.equal(playablePageAudioUrl({ audio_url: '/a/1.mp3', render_type: 'notebook' }), null);
  assert.equal(playablePageAudioUrl({ audio_url: null, render_type: 'notebook' }), null);
});

test('playablePageAudioUrl returns null when there is no audio', () => {
  assert.equal(playablePageAudioUrl({ audio_url: null, render_type: 'static-image' }), null);
  assert.equal(playablePageAudioUrl({ render_type: 'static-image' }), null);
  assert.equal(playablePageAudioUrl(null), null);
  assert.equal(playablePageAudioUrl(undefined), null);
});

// ── spokenScriptFor ─────────────────────────────────────────────────────────

const STEP_ONE = 'We have reached the information-theoretic idea behind the loss function. The starting point is uncertainty. Entropy gives us a way to summarize that uncertainty.';
const STEP_TWO = 'To quantify uncertainty, we first assign a probability to each possible event. Probability tells us how strongly we expect an event before observing it.';

const stepPage = {
  page_number: 5,
  steps: [
    { index: 0, script: STEP_ONE, audio_url: 'a/step-00.m4a', audio_duration_seconds: 27.9 },
    { index: 1, script: STEP_TWO, audio_url: 'a/step-01.m4a', audio_duration_seconds: 20 },
    { index: 2, script: '', audio_url: null, audio_duration_seconds: null },
  ],
} as unknown as PdfDetailPage;
// What a step page's page-level script is: every step joined together.
const PAGE_SCRIPT = `${STEP_ONE}\n${STEP_TWO}`;

test('spokenScriptFor is the current step on a step page, the page script otherwise', () => {
  assert.equal(spokenScriptFor(stepPage, 0, PAGE_SCRIPT), STEP_ONE);
  assert.equal(spokenScriptFor(stepPage, 1, PAGE_SCRIPT), STEP_TWO);
  assert.equal(spokenScriptFor(stepPage, 99, PAGE_SCRIPT), '', 'clamped like the audio URL, to the last step');
  assert.equal(spokenScriptFor(stepPage, -1, PAGE_SCRIPT), STEP_ONE);
  const plain = { page_number: 1, audio_url: 'a/p1.m4a' } as unknown as PdfDetailPage;
  assert.equal(spokenScriptFor(plain, 0, 'Page script.'), 'Page script.');
  assert.equal(spokenScriptFor({ ...plain, steps: [] } as unknown as PdfDetailPage, 3, 'Page script.'), 'Page script.');
  assert.equal(spokenScriptFor(null, 0, 'Page script.'), 'Page script.');
});

test('a silent step has no captions, just as it has no audio', () => {
  assert.equal(playableStepAudioUrl(stepPage, 2), null);
  assert.equal(spokenScriptFor(stepPage, 2, PAGE_SCRIPT), '', 'not the whole page under a step that says nothing');
});

test('reported: three seconds into step one the caption must still be step one', () => {
  // The caption is the sentence whose slot contains the playhead, with sentences spread over the
  // playing clip. Step one's clip is 27.9 s; the playhead is at 3 s (+0.5 s lookahead, as PlayPage).
  const captionAt = (script: string, seconds: number) => {
    const sentences = splitScriptIntoSentences(script);
    const timeline = buildSentenceTimeline(sentences, 27.9);
    const hit = timeline.findIndex((item) => seconds + 0.5 >= item.start && seconds + 0.5 < item.end);
    return sentences[hit] ?? '';
  };
  const stepOneSentences = splitScriptIntoSentences(STEP_ONE);
  // With the step's own script every caption during this clip is one of step one's sentences…
  for (const t of [0, 3, 12, 20, 27]) {
    assert.ok(stepOneSentences.includes(captionAt(spokenScriptFor(stepPage, 0, PAGE_SCRIPT), t)), `at ${t}s`);
  }
  // …whereas the page-level script, squeezed into the same 27.9 s, is already reading step two
  // long before step one's audio ends. That is the bug; this pins that the test can see it.
  assert.ok(splitScriptIntoSentences(STEP_TWO).includes(captionAt(PAGE_SCRIPT, 20)));
});
