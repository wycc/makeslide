import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source-level guards for "does this page have narration" on a step-built page.
 *
 * A page imported from an animated pptx keeps its narration per step (`<uid>.step-00.m4a`, …) and
 * leaves `pages.audio_path` empty, so the backend reports `audio_url: null` for the page and the
 * real URLs under `steps[].audio_url`. Every check that asks the question by reading the
 * page-level field therefore calls a page with five recorded steps silent — which is exactly what
 * happened: the play button on such a page was disabled and titled "此頁無語音" while the audio
 * sat next to it on disk.
 *
 * `playableStepAudioUrl` already answers the question correctly (and falls back to the page-level
 * URL for an ordinary page), so these guards pin that nothing goes back to reading `audio_url` or
 * `playablePageAudioUrl(currentPage)` directly. They are source-level because the alternative is
 * mounting the whole play page with a context of ~200 fields.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the play button and the paused badge judge by the step narration, not the page field', () => {
  const panel = read('./PlayPageSlidePanel.tsx');
  assert.match(panel, /currentStepAudioUrl,\s*\n\s*\} = usePlayPageContext\(\)/, 'the panel takes it from the context');
  // The "no audio" branch of the shared playback button (see playbackButtonWiring.test.ts) must be
  // chosen by the step URL; reading the page-level field there is the bug this guards.
  const noAudioBranch = panel.indexOf('if (!currentStepAudioUrl)');
  assert.ok(noAudioBranch > 0, 'the disabled "no audio" button is chosen by the step URL');
  assert.match(panel.slice(noAudioBranch, noAudioBranch + 400), /play\.slidePanel\.noAudio/);
  assert.match(
    panel,
    /!playbackIndicatorActive && currentStepAudioUrl && currentPage\?\.render_type !== 'notebook'/,
    'the paused badge too — it marks a page that has narration to pause',
  );
  // The page-level field must not be what decides it any more.
  assert.doesNotMatch(panel, /!currentPage\?\.audio_url \? \(/);
});

test('PlayPage asks the same question the same way everywhere', () => {
  const playPage = read('../PlayPage.tsx');
  // Seek, retry, the pause-playback effect and the two <audio> error paths all used to read the
  // page-level URL; on a step page they took the "no audio" branch while audio was playing.
  assert.doesNotMatch(
    playPage,
    /playablePageAudioUrl\(currentPage\)/,
    'no page-level check may remain for the current page',
  );
  assert.doesNotMatch(
    playPage,
    /import \{[^}]*playablePageAudioUrl[^}]*\} from '\.\.\/lib\/pageAudio'/,
    'and the import goes with the last caller',
  );
  assert.match(playPage, /const currentStepAudioUrl = playableStepAudioUrl\(currentPage, currentStep\)/);
  assert.match(playPage, /const nextPlayableUrl = playableStepAudioUrl\(next, 0\)/, 'prefetch: a page opens at step 0');
});

test('the context declares the step narration URL so the panel can be given it', () => {
  const context = read('./PlayPageContext.tsx');
  assert.match(context, /currentStepAudioUrl: string \| null;/);
  const playPage = read('../PlayPage.tsx');
  // Declared but never passed would leave the panel reading undefined — every page silent.
  assert.match(playPage, /\n\s*currentStepAudioUrl,\n/);
});
