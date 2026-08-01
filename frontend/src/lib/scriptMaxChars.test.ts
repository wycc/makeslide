import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeScriptMaxChars,
  parseScriptMaxCharsInput,
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

test('parseScriptMaxCharsInput：範圍內整數視為合法（含上下界）', () => {
  assert.deepEqual(parseScriptMaxCharsInput('350'), { value: 350, invalid: false });
  assert.deepEqual(parseScriptMaxCharsInput(String(SCRIPT_MAX_CHARS_MIN)), { value: 80, invalid: false });
  assert.deepEqual(parseScriptMaxCharsInput(String(SCRIPT_MAX_CHARS_MAX)), { value: 2000, invalid: false });
  assert.deepEqual(parseScriptMaxCharsInput('  350  '), { value: 350, invalid: false });
});

test('parseScriptMaxCharsInput：空白代表未填、不算不合法', () => {
  assert.deepEqual(parseScriptMaxCharsInput(''), { value: null, invalid: false });
  assert.deepEqual(parseScriptMaxCharsInput('   '), { value: null, invalid: false });
});

test('parseScriptMaxCharsInput：超出範圍標為不合法而不夾值', () => {
  assert.deepEqual(parseScriptMaxCharsInput('8'), { value: null, invalid: true });
  assert.deepEqual(parseScriptMaxCharsInput('79'), { value: null, invalid: true });
  assert.deepEqual(parseScriptMaxCharsInput('2001'), { value: null, invalid: true });
  assert.deepEqual(parseScriptMaxCharsInput('0'), { value: null, invalid: true });
});

test('parseScriptMaxCharsInput：非十進位整數一律不合法（不默默取整）', () => {
  for (const raw of ['350.5', '-350', '+350', '1e3', '3,50', '350px', 'abc', '٣٥٠']) {
    assert.deepEqual(parseScriptMaxCharsInput(raw), { value: null, invalid: true }, raw);
  }
});

test('parseScriptMaxCharsInput：前導零不改寫使用者輸入', () => {
  assert.deepEqual(parseScriptMaxCharsInput('0350'), { value: 350, invalid: false });
});
