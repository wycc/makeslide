import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pageStepCount, playableStepAudioUrl } from '../../lib/pageAudio';
import type { PdfDetailPage } from '../../types';

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

function pageWithSteps(audio: Array<string | null>): PdfDetailPage {
  return {
    page_number: 1,
    image_url: 'api/x/pages/1/image',
    text_url: null,
    script_url: null,
    audio_url: 'api/x/pages/1/audio',
    audio_duration_seconds: 9,
    render_type: 'react',
    animation_spec_url: null,
    status: 'audio_ready',
    steps: audio.map((url, index) => ({
      index,
      script: `step ${index}`,
      audio_url: url,
      audio_duration_seconds: url ? 2 : null,
    })),
  } as PdfDetailPage;
}

test('a step-built page plays the current step’s narration, not the whole page’s', () => {
  const page = pageWithSteps(['a0', 'a1', 'a2']);
  assert.equal(pageStepCount(page), 3);
  assert.equal(playableStepAudioUrl(page, 0), 'a0');
  assert.equal(playableStepAudioUrl(page, 2), 'a2');
});

test('a step with nothing to say is silent, rather than replaying the whole slide', () => {
  const page = pageWithSteps(['a0', null]);
  // Falling back to page.audio_url here would restart the entire narration on every click.
  assert.equal(playableStepAudioUrl(page, 1), null);
});

test('an out-of-range step clamps instead of going silent', () => {
  const page = pageWithSteps(['a0', 'a1']);
  assert.equal(playableStepAudioUrl(page, 9), 'a1');
  assert.equal(playableStepAudioUrl(page, -3), 'a0');
});

test('an ordinary page is unaffected: it still plays its own audio', () => {
  const page = { ...pageWithSteps([]), steps: null } as PdfDetailPage;
  assert.equal(pageStepCount(page), 0);
  assert.equal(playableStepAudioUrl(page, 0), 'api/x/pages/1/audio');
  assert.equal(playableStepAudioUrl(null, 0), null);
});

/**
 * The rest is source-level, like the other player wiring tests: these paths only misbehave in a
 * running browser, and each failure is silent — a step that plays the wrong voice, a page that
 * opens half-built, or arrows that turn the page instead of advancing the build.
 */
test('the step resets on a page change and drives which narration is loaded', () => {
  const src = read('../PlayPage.tsx');
  assert.match(src, /setCurrentStep\(0\);\s*\n\s*\}, \[currentPage\?\.page_number\]\);/, 'every page starts at step 0');
  assert.match(src, /const playableUrl = playableStepAudioUrl\(currentPage, currentStep\);/);
  // The audio effect must re-run on a step change, or the next step would play the previous voice.
  assert.match(src, /\}, \[currentPage\?\.page_number, currentStep, clearAudioRetryTimer/);
});

test('the end of a step’s audio advances the build instead of ending the page', () => {
  const src = read('../PlayPage.tsx');
  const handler = src.slice(src.indexOf('const handleEnded'), src.indexOf('const handleEnded') + 900);
  assert.match(handler, /stepCount > 0 && currentStep < stepCount - 1/);
  // It returns *before* setIsPlaying(false): playback continues into the next step.
  const advance = handler.indexOf('setCurrentStep');
  const stop = handler.indexOf('setIsPlaying(false)');
  assert.ok(advance > 0 && advance < stop, 'the step advances before playback would be stopped');
});

test('up/down walk the build on a step page, in fullscreen or not, and never turn the page', () => {
  const src = read('../PlayPage.tsx');
  const block = src.slice(src.indexOf("ev.key === 'ArrowUp' || ev.key === 'ArrowDown'"));
  const handler = block.slice(0, block.indexOf('else if'));
  assert.match(handler, /if \(stepCount > 0\) \{/, 'step pages claim the key');
  assert.match(handler, /Math\.min\(Math\.max\(step \+ delta, 0\), stepCount - 1\)/, 'it clamps at both ends');
  assert.ok(!/goNext\(\)|goPrev\(\)/.test(handler), 'and never turns the page');
  // Not gated on fullscreen: stepping by hand is the whole point of these pages.
  const fullscreenGate = handler.indexOf('isFullscreen &&');
  const stepGate = handler.indexOf('stepCount > 0');
  assert.ok(stepGate < fullscreenGate || fullscreenGate === -1, 'the step path is not behind the fullscreen gate');
});

test('every view that shows a React page passes the step down to the sandbox', () => {
  const panel = read('./PlayPageSlidePanel.tsx');
  const fullscreen = read('./PlayPageFullscreen.tsx');
  assert.match(panel, /step: currentPageStep,/);
  assert.equal((fullscreen.match(/step: currentPageStep,/g) ?? []).length, 2, 'both fullscreen layouts');
  const renderer = read('../../components/slide/SlideRenderer.tsx');
  assert.match(renderer, /step=\{reactSlide\.step\}/);
});
