import test from 'node:test';
import assert from 'node:assert/strict';
import { UI_LANGUAGE_LABELS, normalizeLanguage, otherUiLanguage, translate, normalizePlaybackSpeed, type TranslationKey } from './i18n';
import { zhTW } from './locales/zh-TW';
import { en } from './locales/en';

test('normalizeLanguage accepts the two supported languages', () => {
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('zh-TW'), 'zh-TW');
});

test('otherUiLanguage 回傳「切換鈕要切過去的那個語言」', () => {
  assert.equal(otherUiLanguage('zh-TW'), 'en');
  assert.equal(otherUiLanguage('en'), 'zh-TW');
});

test('語言標籤用該語言自己的寫法，不隨介面語言翻譯', () => {
  // 看不懂目前介面語言的人，就是靠這個標籤找到出口；翻譯它等於把出口也藏起來
  assert.equal(UI_LANGUAGE_LABELS.en, 'English');
  assert.equal(UI_LANGUAGE_LABELS['zh-TW'], '中文');
});

test('normalizeLanguage falls back for unsupported or non-string values', () => {
  assert.equal(normalizeLanguage('fr'), 'zh-TW');
  assert.equal(normalizeLanguage(null), 'zh-TW');
  assert.equal(normalizeLanguage(undefined), 'zh-TW');
  assert.equal(normalizeLanguage(123), 'zh-TW');
  assert.equal(normalizeLanguage('xx', 'en'), 'en'); // custom fallback
});

test('translate returns the requested language entry', () => {
  const key: TranslationKey = 'app.loadingSettings';
  assert.equal(translate('en', key), en[key]);
  assert.equal(translate('zh-TW', key), zhTW[key]);
});

test('translate falls back to zh-TW then to the key itself when missing', () => {
  const missing = '__definitely.not.a.key__' as TranslationKey;
  assert.equal(translate('en', missing), '__definitely.not.a.key__');
});

test('normalizePlaybackSpeed accepts allowed speeds as number or numeric string', () => {
  assert.equal(normalizePlaybackSpeed(1.5), 1.5);
  assert.equal(normalizePlaybackSpeed(0.5), 0.5);
  assert.equal(normalizePlaybackSpeed('2'), 2);
  assert.equal(normalizePlaybackSpeed('0.75'), 0.75);
});

test('normalizePlaybackSpeed falls back for out-of-set or non-numeric values', () => {
  assert.equal(normalizePlaybackSpeed(1.1), 1); // not in the allowed set
  assert.equal(normalizePlaybackSpeed('abc'), 1);
  assert.equal(normalizePlaybackSpeed(null), 1);
  assert.equal(normalizePlaybackSpeed(NaN), 1);
  assert.equal(normalizePlaybackSpeed(3, 2), 2); // custom fallback
});
