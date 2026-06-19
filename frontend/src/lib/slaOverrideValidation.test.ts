import test from 'node:test';
import assert from 'node:assert/strict';

import { formatSlaOverrideRangeMessage, validateSlaOverrideSecondsInput } from './slaOverrideValidation';

test('validateSlaOverrideSecondsInput keeps blank input as clearing the override', () => {
  assert.deepEqual(validateSlaOverrideSecondsInput('   ', { min_ms: 1000, max_ms: 60_000 }), {
    ok: true,
    targetMs: null,
  });
});

test('validateSlaOverrideSecondsInput preserves finite-number validation', () => {
  assert.deepEqual(validateSlaOverrideSecondsInput('not-a-number', { min_ms: 1000, max_ms: 60_000 }), {
    ok: false,
    reason: 'invalid-number',
  });
});

test('validateSlaOverrideSecondsInput converts valid seconds to milliseconds', () => {
  assert.deepEqual(validateSlaOverrideSecondsInput('1.25', { min_ms: 1000, max_ms: 60_000 }), {
    ok: true,
    targetMs: 1250,
  });
});

test('validateSlaOverrideSecondsInput rejects values outside server-provided bounds', () => {
  assert.deepEqual(validateSlaOverrideSecondsInput('0.5', { min_ms: 1000, max_ms: 60_000 }), {
    ok: false,
    reason: 'out-of-range',
    minSeconds: 1,
    maxSeconds: 60,
  });
  assert.deepEqual(validateSlaOverrideSecondsInput('61', { min_ms: 1000, max_ms: 60_000 }), {
    ok: false,
    reason: 'out-of-range',
    minSeconds: 1,
    maxSeconds: 60,
  });
});

test('formatSlaOverrideRangeMessage injects allowed range in seconds', () => {
  assert.equal(
    formatSlaOverrideRangeMessage('請輸入 {min} 到 {max} 秒之間的 SLA 目標', 1, 60),
    '請輸入 1 到 60 秒之間的 SLA 目標',
  );
});
