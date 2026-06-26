import test from 'node:test';
import assert from 'node:assert/strict';
import { en } from './locales/en';
import { zhTW } from './locales/zh-TW';

// The generic parity test (i18n.test.ts) only ensures zh-TW and en expose the
// *same* keys — it would still pass if a Theme key were dropped from *both*
// locales. This focused test guards that the Theme feature's user-facing keys
// actually exist (and are non-empty) in both dictionaries, so an accidental
// removal during refactors is caught.
const REQUIRED_KEYS = [
  'settings.theme',
  'settings.themeSystem',
  'settings.themeLight',
  'settings.themeDark',
  'settings.themeHint',
] as const;

test('Theme settings i18n keys exist and are non-empty in both locales', () => {
  for (const key of REQUIRED_KEYS) {
    assert.ok(key in zhTW, `zh-TW is missing ${key}`);
    assert.ok(key in en, `en is missing ${key}`);
    assert.equal(typeof zhTW[key as keyof typeof zhTW], 'string');
    assert.equal(typeof en[key as keyof typeof en], 'string');
    assert.ok((zhTW[key as keyof typeof zhTW] as string).trim().length > 0, `zh-TW ${key} is empty`);
    assert.ok((en[key as keyof typeof en] as string).trim().length > 0, `en ${key} is empty`);
  }
});
