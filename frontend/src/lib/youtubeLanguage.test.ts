import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeYoutubeSubtitleLanguageForSubmit, YOUTUBE_SUBTITLE_LANGUAGE_OPTIONS } from './youtubeLanguage';

test('YOUTUBE_SUBTITLE_LANGUAGE_OPTIONS exposes common quick choices in display order', () => {
  assert.deepEqual(YOUTUBE_SUBTITLE_LANGUAGE_OPTIONS, ['zh-TW', 'en', 'ja', 'auto']);
});

test('normalizeYoutubeSubtitleLanguageForSubmit keeps explicit subtitle language values', () => {
  assert.equal(normalizeYoutubeSubtitleLanguageForSubmit('zh-TW'), 'zh-TW');
  assert.equal(normalizeYoutubeSubtitleLanguageForSubmit(' en '), 'en');
  assert.equal(normalizeYoutubeSubtitleLanguageForSubmit('ja'), 'ja');
});

test('normalizeYoutubeSubtitleLanguageForSubmit maps auto or blank language to undefined', () => {
  assert.equal(normalizeYoutubeSubtitleLanguageForSubmit('auto'), undefined);
  assert.equal(normalizeYoutubeSubtitleLanguageForSubmit(' AUTO '), undefined);
  assert.equal(normalizeYoutubeSubtitleLanguageForSubmit('   '), undefined);
});
