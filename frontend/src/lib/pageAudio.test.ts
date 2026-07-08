import test from 'node:test';
import assert from 'node:assert/strict';
import { playablePageAudioUrl } from './pageAudio';

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
