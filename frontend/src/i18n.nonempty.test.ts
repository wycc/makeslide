import test from 'node:test';
import assert from 'node:assert/strict';
import { en } from './locales/en';
import { zhTW } from './locales/zh-TW';

// The parity test in i18n.test.ts checks that both locales expose the same keys
// and the same {placeholder} sets, but it would still pass if a value were left
// blank. This guard ensures every translation is a non-empty (non-whitespace)
// string, catching accidental blank translations.
//
// A few keys are intentionally empty in one locale because the languages place
// the affix differently: Chinese uses a trailing「頁」suffix ("第 N 頁") while
// English uses a leading "Page N" with no suffix. Those keys are allow-listed so
// the guard still catches genuine oversights elsewhere.
const ALLOWED_EMPTY = new Set<string>([
  'play.common.pageSuffix',
  'quiz.aiGeneratePageSuffix',
  'quiz.countdownPrefix',
  'remote.slideAltSuffix',
  'play.report.pageSuffix',
]);

function assertAllNonEmpty(dict: Record<string, string>, name: string): void {
  const blanks: string[] = [];
  for (const [key, value] of Object.entries(dict)) {
    if (ALLOWED_EMPTY.has(key)) continue;
    if (typeof value !== 'string' || value.trim().length === 0) {
      blanks.push(key);
    }
  }
  assert.equal(blanks.length, 0, `${name} has unexpected blank values for: ${blanks.join(', ')}`);
}

test('every Traditional Chinese locale value is a non-empty string (except allow-listed affixes)', () => {
  assertAllNonEmpty(zhTW, 'zh-TW');
});

test('every English locale value is a non-empty string (except allow-listed affixes)', () => {
  assertAllNonEmpty(en, 'en');
});

test('allow-listed empty keys are non-empty in at least one locale (so the allow-list stays honest)', () => {
  for (const key of ALLOWED_EMPTY) {
    const zhVal = (zhTW as Record<string, string>)[key] ?? '';
    const enVal = (en as Record<string, string>)[key] ?? '';
    assert.ok(
      zhVal.trim().length > 0 || enVal.trim().length > 0,
      `allow-listed key ${key} is blank in both locales — remove it or fix the translation`,
    );
  }
});
