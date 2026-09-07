import test from 'node:test';
import assert from 'node:assert/strict';
import { pageEntryPresentationTime } from './pageEntryTime';
import type { SlideAnimationSpec } from '../types';

const spec = (effects: Array<[number, number, string?]>, enabled = true): SlideAnimationSpec =>
  ({ version: 1, enabled, effects: effects.map(([start, duration, type], i) => ({ id: `e${i}`, target: 'slide', type: type ?? 'overlay-image', start, duration, ease: 'power1.out' })) }) as SlideAnimationSpec;

test('paused at the page start, opening effects are presented as already entered', () => {
  // Title fade (0 → 0.8) and a second effect at 4 s: show 0.8, well before 4.
  assert.equal(pageEntryPresentationTime(spec([[0, 0.8], [4, 0.8]]), 0, false), 0.8);
  // Two opening effects: the longer entrance wins.
  assert.equal(pageEntryPresentationTime(spec([[0, 0.3], [0.02, 1.2]]), 0, false), 1.22);
  // The next effect starting inside the opening entrance caps the presentation just before it.
  assert.equal(pageEntryPresentationTime(spec([[0, 2], [0.5, 1]]), 0, false), 0.49);
});

test('paused on a presenter step mid-page, the effects that begin there are presented as entered', () => {
  // TNQ62wZM_z page 1: four cut-outs at 8.33 / 38.6 / 73.83 / 94.38 s. Stepping to 8.33 while paused
  // must show the first one, not frame zero of its fade.
  const s = spec([[8.33, 0.8], [38.6, 0.8], [73.83, 0.8], [94.38, 0.8]]);
  assert.equal(pageEntryPresentationTime(s, 8.33, false), 9.13);
  assert.equal(pageEntryPresentationTime(s, 8.36, false), 9.13, 'the audio element may land a hair off the requested time');
  assert.equal(pageEntryPresentationTime(s, 38.6, false), 39.4, 'the second step shows the second effect; the first is long since in');
  assert.equal(pageEntryPresentationTime(s, 20, false), 20, 'paused where nothing begins → unchanged');
  // Two effects merged into one step (0.1 s apart) both enter; the next step caps the presentation.
  assert.equal(pageEntryPresentationTime(spec([[8, 0.8], [8.1, 1.5], [9.2, 0.8]]), 8, false), 9.19);
});

test('it leaves the time alone while playing, away from the start, or without an enabled animation', () => {
  const s = spec([[0, 0.8]]);
  assert.equal(pageEntryPresentationTime(s, 0, true), 0);
  assert.equal(pageEntryPresentationTime(s, 3, false), 3);
  assert.equal(pageEntryPresentationTime(spec([[0, 0.8]], false), 0, false), 0);
  assert.equal(pageEntryPresentationTime(null, 0, false), 0);
  assert.equal(pageEntryPresentationTime(spec([[2, 0.8]]), 0, false), 0, 'nothing opens at 0 → nothing to show early');
  assert.equal(pageEntryPresentationTime(spec([[0, 1, 'pause-playback']]), 0, false), 0, 'pause markers are not entrances');
});
