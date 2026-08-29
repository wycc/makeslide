import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tutorLanguageInstruction,
  tutorNoAnswerFallback,
  tutorRoleLine,
} from '../src/services/contentLanguage';

/**
 * The AI tutor answers in the deck's 「輸出語言」.
 *
 * It used to open with 「你是繁體中文課堂 AI 導師」 and never read the setting, so an English deck
 * answered an English question in Chinese — the same failure the top of contentLanguage.ts
 * describes, in the one place that had been missed.
 */

test('the tutor is told to answer in English when that is the output language', () => {
  const line = tutorRoleLine('en');
  assert.match(line, /answer in English/i);
  // The mismatch has to be addressed explicitly: an English deck built from Chinese slides is the
  // normal case, and without this the model follows the material instead of the setting.
  assert.match(line, /even when the slides|another language/i);
  assert.ok(!/繁體中文/.test(line), 'the English role line must not ask for Chinese');
});

test('the tutor keeps answering in Traditional Chinese when that is the setting', () => {
  const line = tutorRoleLine('zh-TW');
  assert.match(line, /繁體中文/);
  assert.ok(!/English/.test(line));
});

test('the language is restated at the end, because the rules in between are in Chinese', () => {
  // A single line appended after a wall of Chinese instructions is the arrangement that already
  // lost once (see contentLanguage.ts) — hence one at each end.
  const closing = tutorLanguageInstruction('en');
  assert.match(closing, /English/);
  assert.match(closing, /format/i, 'it must say the Chinese rules describe format only');
});

test('the no-answer fallback is in the answering language, not always Chinese', () => {
  // Shown to the student verbatim rather than fed to a model.
  assert.match(tutorNoAnswerFallback('en'), /^Sorry/);
  assert.ok(!/[一-鿿]/.test(tutorNoAnswerFallback('en')), 'no Chinese in the English fallback');
  assert.match(tutorNoAnswerFallback('zh-TW'), /很抱歉/);
});
