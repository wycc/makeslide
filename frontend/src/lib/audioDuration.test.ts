import test from 'node:test';
import assert from 'node:assert/strict';

import { formatAudioDuration } from './audioDuration';

test('formatAudioDuration formats seconds under one minute', () => {
  assert.equal(formatAudioDuration(7), '0:07');
  assert.equal(formatAudioDuration(59), '0:59');
});

test('formatAudioDuration formats minutes', () => {
  assert.equal(formatAudioDuration(12 * 60 + 34), '12:34');
});

test('formatAudioDuration formats hours', () => {
  assert.equal(formatAudioDuration(3600 + 2 * 60 + 3), '1:02:03');
});

test('formatAudioDuration hides missing or invalid values', () => {
  assert.equal(formatAudioDuration(null), null);
  assert.equal(formatAudioDuration(undefined), null);
  assert.equal(formatAudioDuration(Number.NaN), null);
  assert.equal(formatAudioDuration(-1), null);
});
