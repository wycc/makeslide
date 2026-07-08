import test from 'node:test';
import assert from 'node:assert/strict';

import { sumAudioDurationSeconds, sumPageAudioDurations } from '../src/worker/audioDurationSum';

test('sumAudioDurationSeconds returns null when no usable durations are present', () => {
  assert.equal(sumAudioDurationSeconds([]), null);
  assert.equal(sumAudioDurationSeconds([null, undefined]), null);
  assert.equal(sumAudioDurationSeconds([0, -3, Number.NaN, Number.POSITIVE_INFINITY]), null);
});

test('sumAudioDurationSeconds adds only finite positive values', () => {
  assert.equal(sumAudioDurationSeconds([1.5, null, 2.5, undefined, -1, 0]), 4);
});

test('sumAudioDurationSeconds rounds the total to millisecond precision', () => {
  // 0.1 + 0.2 = 0.30000000000000004 in floating point → rounded to 0.3
  assert.equal(sumAudioDurationSeconds([0.1, 0.2]), 0.3);
});

test('sumPageAudioDurations excludes notebook pages even when they carry a duration', () => {
  const pages = [
    { audio_duration_seconds: 3, render_type: 'static-image' },
    { audio_duration_seconds: 5, render_type: 'notebook' }, // lingering duration; must be ignored
    { audio_duration_seconds: 2, render_type: null }, // legacy row → counts
  ];
  assert.equal(sumPageAudioDurations(pages), 5); // 3 + 2, not 10
});

test('sumPageAudioDurations returns null when only notebook pages have durations', () => {
  assert.equal(
    sumPageAudioDurations([
      { audio_duration_seconds: 7, render_type: 'notebook' },
      { audio_duration_seconds: null, render_type: 'static-image' },
    ]),
    null,
  );
});
