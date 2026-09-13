import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source-level guards for the play/pause button in the player control row.
 *
 * That row is ⏮ · page number · **play/pause** · ⏭ · QR · progress · volume, and it was that way
 * until the four-panel refactor (f25c7400) moved the button to the corner of the slide stage and
 * left a comment in its place. The row then read as a player with a volume slider, a scrubber and
 * no way to start playing — so the button is back, and this pins it there.
 *
 * Both sites render the same helper on purpose: it is really three buttons (retry after a failed
 * load / disabled with "no audio" / the actual toggle), and two hand-written copies of that would
 * drift apart.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the control row has a play/pause button, between the page number and next-page', () => {
  const panel = read('./PlayPageSlidePanel.tsx');
  const rowStart = panel.indexOf("t('play.slidePanel.jumpToPage')");
  assert.ok(rowStart > 0, 'the control row is found by its page-number input');
  const nextPage = panel.indexOf("t('play.slidePanel.nextPage')", rowStart);
  assert.ok(nextPage > rowStart, 'next-page follows the page number in the same row');
  const between = panel.slice(rowStart, nextPage);
  assert.match(between, /\{renderPlaybackButton\(\)\}/, 'play/pause sits between them, as it did before');
});

test('the slide-stage corner draws the same button rather than its own copy', () => {
  const panel = read('./PlayPageSlidePanel.tsx');
  assert.match(panel, /\{renderPlaybackButton\('shadow-lg'\)\}/);
  // Two call sites, one implementation.
  assert.equal((panel.match(/\{renderPlaybackButton\(/g) ?? []).length, 2, 'exactly two call sites');
  assert.match(panel, /const renderPlaybackButton = \(extraClass = ''\) => \{/, 'and one definition');
});

test('the button keeps all three states, and stays absent on a notebook page', () => {
  const panel = read('./PlayPageSlidePanel.tsx');
  const start = panel.indexOf('const renderPlaybackButton =');
  assert.ok(start > 0);
  const body = panel.slice(start, panel.indexOf('\n  return (', start));
  // A notebook page plays no audio; a disabled button there is noise, not information.
  assert.match(body, /currentPage\.render_type === 'notebook'\) return null/);
  assert.match(body, /if \(audioError\)/, 'a failed load offers a retry');
  assert.match(body, /t\('play\.slidePanel\.audioRetry'\)/);
  // Step-built pages: judged by the step narration, never the page-level field.
  assert.match(body, /if \(!currentStepAudioUrl\)/);
  assert.match(body, /t\('play\.slidePanel\.noAudio'\)/);
  assert.match(body, /onClick=\{playPause\}/);
  assert.match(body, /\(Space\)/, 'the shortcut is in the tooltip, as the old button had it');
  // The pause glyph must follow the indicator, not isPlaying — during an animation extension the
  // screen is still moving while isPlaying is already false.
  assert.match(body, /playbackIndicatorActive \? '⏸' : '▶︎'/);
});
