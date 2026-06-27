import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeScriptMaxChars,
  SCRIPT_MAX_CHARS_MIN,
  SCRIPT_MAX_CHARS_MAX,
} from './scriptMaxChars';

test('範圍內整數原樣回傳（含上下界）', () => {
  assert.equal(normalizeScriptMaxChars(350), 350);
  assert.equal(normalizeScriptMaxChars(SCRIPT_MAX_CHARS_MIN), 80);
  assert.equal(normalizeScriptMaxChars(SCRIPT_MAX_CHARS_MAX), 2000);
});

test('低於下限拉回 80、高於上限拉回 2000', () => {
  assert.equal(normalizeScriptMaxChars(0), 80);
  assert.equal(normalizeScriptMaxChars(-50), 80);
  assert.equal(normalizeScriptMaxChars(5000), 2000);
});

test('非整數先四捨五入再夾範圍', () => {
  assert.equal(normalizeScriptMaxChars(349.4), 349);
  assert.equal(normalizeScriptMaxChars(349.5), 350);
  assert.equal(normalizeScriptMaxChars(79.6), 80);
  assert.equal(normalizeScriptMaxChars(2000.4), 2000);
});

test('與舊內聯寫法輸出一致', () => {
  const oldInline = (x: number) => Math.max(80, Math.min(2000, Math.round(x)));
  for (const v of [80, 81, 350, 1999, 2000, 0, -10, 12345, 123.6]) {
    assert.equal(normalizeScriptMaxChars(v), oldInline(v));
  }
});

test('NaN 仍傳遞為 NaN（與原寫法一致，呼叫端自行防呆）', () => {
  assert.ok(Number.isNaN(normalizeScriptMaxChars(NaN)));
});
