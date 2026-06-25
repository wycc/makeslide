import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime, buildRelativeTimeLabels, RELATIVE_TIME_LABEL_KEYS, type RelativeTimeLabels } from './relativeTime';

const labels: RelativeTimeLabels = {
  justNow: 'just now',
  minutes: { one: ' minute ago', other: ' minutes ago' },
  hours: { one: ' hour ago', other: ' hours ago' },
  days: { one: ' day ago', other: ' days ago' },
  months: { one: ' month ago', other: ' months ago' },
  years: { one: ' year ago', other: ' years ago' },
};

const NOW = new Date('2026-06-25T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('formatRelativeTime picks the right bucket (plural)', () => {
  assert.equal(formatRelativeTime(ago(30 * 1000), labels, NOW), 'just now');
  assert.equal(formatRelativeTime(ago(5 * MIN), labels, NOW), '5 minutes ago');
  assert.equal(formatRelativeTime(ago(3 * HOUR), labels, NOW), '3 hours ago');
  assert.equal(formatRelativeTime(ago(2 * DAY), labels, NOW), '2 days ago');
  assert.equal(formatRelativeTime(ago(40 * DAY), labels, NOW), '1 month ago');
  assert.equal(formatRelativeTime(ago(400 * DAY), labels, NOW), '1 year ago');
});

test('formatRelativeTime uses singular forms when the count is 1', () => {
  assert.equal(formatRelativeTime(ago(1 * MIN), labels, NOW), '1 minute ago');
  assert.equal(formatRelativeTime(ago(1 * HOUR), labels, NOW), '1 hour ago');
  assert.equal(formatRelativeTime(ago(1 * DAY), labels, NOW), '1 day ago');
});

test('formatRelativeTime returns the raw string on invalid input', () => {
  assert.equal(formatRelativeTime('not-a-date', labels, NOW), 'not-a-date');
});

test('buildRelativeTimeLabels maps each field to its time.* key(s)', () => {
  // Fake t echoes the key so we can assert the mapping.
  const built = buildRelativeTimeLabels((key) => `[${key}]`);
  assert.equal(built.justNow, `[${RELATIVE_TIME_LABEL_KEYS.justNow}]`);
  assert.equal(built.minutes.one, `[${RELATIVE_TIME_LABEL_KEYS.minutes.one}]`);
  assert.equal(built.minutes.other, `[${RELATIVE_TIME_LABEL_KEYS.minutes.other}]`);
  assert.equal(built.days.one, `[${RELATIVE_TIME_LABEL_KEYS.days.one}]`);
  assert.equal(built.years.other, `[${RELATIVE_TIME_LABEL_KEYS.years.other}]`);
});
