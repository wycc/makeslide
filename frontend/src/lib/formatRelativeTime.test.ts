import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime } from './formatRelativeTime';

const NOW = new Date('2026-06-26T12:00:00.000Z');

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

test('formatRelativeTime: within 60 seconds returns "剛剛"', () => {
  assert.equal(formatRelativeTime(ago(0), NOW), '剛剛');
  assert.equal(formatRelativeTime(ago(30_000), NOW), '剛剛');
  assert.equal(formatRelativeTime(ago(59_000), NOW), '剛剛');
});

test('formatRelativeTime: 1-59 minutes returns "N 分鐘前"', () => {
  assert.equal(formatRelativeTime(ago(60_000), NOW), '1 分鐘前');
  assert.equal(formatRelativeTime(ago(5 * 60_000), NOW), '5 分鐘前');
  assert.equal(formatRelativeTime(ago(59 * 60_000), NOW), '59 分鐘前');
});

test('formatRelativeTime: 1-23 hours returns "N 小時前"', () => {
  assert.equal(formatRelativeTime(ago(60 * 60_000), NOW), '1 小時前');
  assert.equal(formatRelativeTime(ago(3 * 60 * 60_000), NOW), '3 小時前');
  assert.equal(formatRelativeTime(ago(23 * 60 * 60_000), NOW), '23 小時前');
});

test('formatRelativeTime: 24-47 hours returns "昨天"', () => {
  assert.equal(formatRelativeTime(ago(24 * 60 * 60_000), NOW), '昨天');
  assert.equal(formatRelativeTime(ago(47 * 60 * 60_000), NOW), '昨天');
});

test('formatRelativeTime: 48-71 hours returns "2 天前"', () => {
  assert.equal(formatRelativeTime(ago(48 * 60 * 60_000), NOW), '2 天前');
});

test('formatRelativeTime: >= 3 days returns localised date string', () => {
  const result = formatRelativeTime(ago(3 * 24 * 60 * 60_000), NOW);
  assert.ok(typeof result === 'string' && result.length > 0);
  assert.ok(!result.includes('前') && !result.includes('昨天') && !result.includes('剛剛'));
});

test('formatRelativeTime: invalid ISO string returns the input unchanged', () => {
  assert.equal(formatRelativeTime('not-a-date', NOW), 'not-a-date');
});
