import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db';
import {
  weekStartIso,
  nextWeekStartIso,
  getAccountWeeklyUsage,
  hasDefaultSourceQuotaRemaining,
  recordDefaultSourceCost,
  getDefaultSourceWeeklyQuotaUsd,
  DefaultSourceQuotaExceededError,
  isDefaultSourceQuotaExceededError,
  defaultSourceQuotaExceededMessage,
} from '../src/services/defaultSourceQuota';

const TEST_ACCOUNT_ID = 'default-source-quota-test-01';

function cleanup(): void {
  db.prepare(`DELETE FROM account_weekly_usage WHERE account_id = ?`).run(TEST_ACCOUNT_ID);
}

test('weekStartIso buckets any day of the week to the most recent Thursday (UTC)', () => {
  // 2026-07-16 is a Thursday.
  assert.equal(weekStartIso(new Date('2026-07-16T00:00:00.000Z')), '2026-07-16');
  assert.equal(weekStartIso(new Date('2026-07-16T23:59:59.000Z')), '2026-07-16');
  // Friday/Saturday of the same week still bucket to that Thursday.
  assert.equal(weekStartIso(new Date('2026-07-17T12:00:00.000Z')), '2026-07-16');
  assert.equal(weekStartIso(new Date('2026-07-18T12:00:00.000Z')), '2026-07-16');
  // Sunday through Wednesday bucket to the *previous* Thursday.
  assert.equal(weekStartIso(new Date('2026-07-19T12:00:00.000Z')), '2026-07-16');
  assert.equal(weekStartIso(new Date('2026-07-22T12:00:00.000Z')), '2026-07-16');
});

test('nextWeekStartIso is always exactly one week after weekStartIso', () => {
  const now = new Date('2026-07-19T09:00:00.000Z');
  assert.equal(weekStartIso(now), '2026-07-16');
  assert.equal(nextWeekStartIso(now), '2026-07-23');
});

test('getAccountWeeklyUsage starts at zero cost with the full quota remaining', () => {
  cleanup();
  try {
    const usage = getAccountWeeklyUsage(TEST_ACCOUNT_ID);
    assert.equal(usage.costUsd, 0);
    assert.equal(usage.quotaUsd, getDefaultSourceWeeklyQuotaUsd());
    assert.equal(usage.remainingUsd, usage.quotaUsd);
    assert.equal(hasDefaultSourceQuotaRemaining(TEST_ACCOUNT_ID), usage.quotaUsd > 0);
  } finally {
    cleanup();
  }
});

test('recordDefaultSourceCost accumulates across multiple calls for the same week and account', () => {
  cleanup();
  try {
    const quota = getDefaultSourceWeeklyQuotaUsd();
    recordDefaultSourceCost(TEST_ACCOUNT_ID, quota / 4);
    recordDefaultSourceCost(TEST_ACCOUNT_ID, quota / 4);
    const usage = getAccountWeeklyUsage(TEST_ACCOUNT_ID);
    assert.ok(Math.abs(usage.costUsd - quota / 2) < 1e-9);
    assert.ok(Math.abs(usage.remainingUsd - quota / 2) < 1e-9);
  } finally {
    cleanup();
  }
});

test('recordDefaultSourceCost is a no-op for zero/negative amounts', () => {
  cleanup();
  try {
    recordDefaultSourceCost(TEST_ACCOUNT_ID, 0);
    recordDefaultSourceCost(TEST_ACCOUNT_ID, -5);
    assert.equal(getAccountWeeklyUsage(TEST_ACCOUNT_ID).costUsd, 0);
  } finally {
    cleanup();
  }
});

test('hasDefaultSourceQuotaRemaining flips to false once the quota is fully spent', () => {
  cleanup();
  try {
    const quota = getDefaultSourceWeeklyQuotaUsd();
    assert.ok(quota > 0, 'test assumes a positive default quota is configured');
    recordDefaultSourceCost(TEST_ACCOUNT_ID, quota);
    assert.equal(hasDefaultSourceQuotaRemaining(TEST_ACCOUNT_ID), false);
    assert.equal(getAccountWeeklyUsage(TEST_ACCOUNT_ID).remainingUsd, 0);
  } finally {
    cleanup();
  }
});

test('recordDefaultSourceCost never lets remainingUsd go negative when cost exceeds quota', () => {
  cleanup();
  try {
    const quota = getDefaultSourceWeeklyQuotaUsd();
    recordDefaultSourceCost(TEST_ACCOUNT_ID, quota * 3);
    assert.equal(getAccountWeeklyUsage(TEST_ACCOUNT_ID).remainingUsd, 0);
  } finally {
    cleanup();
  }
});

test('DefaultSourceQuotaExceededError is recognised by isDefaultSourceQuotaExceededError', () => {
  const err = new DefaultSourceQuotaExceededError('nope');
  assert.equal(isDefaultSourceQuotaExceededError(err), true);
  assert.equal(isDefaultSourceQuotaExceededError(new Error('unrelated')), false);
});

test('defaultSourceQuotaExceededMessage mentions the reset date and current usage', () => {
  const usage = { weekStart: '2026-07-16', nextReset: '2026-07-23', costUsd: 1, quotaUsd: 1, remainingUsd: 0 };
  const msg = defaultSourceQuotaExceededMessage(usage);
  assert.match(msg, /2026-07-23/);
  assert.match(msg, /\$1\.00/);
});
