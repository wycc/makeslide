import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasLocalStorage } from './hasLocalStorage';

const g = globalThis as { window?: unknown };

test('hasLocalStorage is false in a non-browser (no window) environment', () => {
  // node:test runs without a DOM, so window is undefined here.
  assert.equal(typeof window === 'undefined', true);
  assert.equal(hasLocalStorage(), false);
});

test('hasLocalStorage is true when window.localStorage is present', () => {
  (g as { window: unknown }).window = { localStorage: {} };
  try {
    assert.equal(hasLocalStorage(), true);
  } finally {
    delete g.window; // restore the non-browser baseline so other tests are unaffected
  }
});

test('hasLocalStorage is false when window exists but localStorage is missing', () => {
  (g as { window: unknown }).window = {};
  try {
    assert.equal(hasLocalStorage(), false);
  } finally {
    delete g.window;
  }
});
