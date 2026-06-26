import test from 'node:test';
import assert from 'node:assert/strict';

import { ERROR_HINT_KEYS } from './common';
import { zhTW } from '../../locales/zh-TW';
import { en } from '../../locales/en';

// mapApiErrorToHumanMessage builds the per-code hint keys dynamically via
// `as TranslationKey`, which bypasses the compile-time check that every key
// actually exists in the dictionaries. A missing/typo'd key would silently
// surface the raw key string (e.g. "apiError.invalidRequest.title") to users.
// This guard asserts every hint key referenced by ERROR_HINT_KEYS is defined in
// both locales, catching drift at test time instead of in the UI.
test('every ERROR_HINT_KEYS entry resolves to a defined key in both locales', () => {
  const zhKeys = new Set(Object.keys(zhTW));
  const enKeys = new Set(Object.keys(en));
  for (const [code, keys] of Object.entries(ERROR_HINT_KEYS)) {
    for (const field of ['title', 'message', 'nextStep'] as const) {
      const key = keys[field];
      assert.ok(zhKeys.has(key), `zh-TW missing ${key} (for code ${code}.${field})`);
      assert.ok(enKeys.has(key), `en missing ${key} (for code ${code}.${field})`);
    }
  }
});
