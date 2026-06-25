import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime, buildRelativeTimeLabels, RELATIVE_TIME_LABEL_KEYS, type RelativeTimeLabels } from './relativeTime';

const labels: RelativeTimeLabels = {
  justNow: 'just now',
  minutesSuffix: ' min ago',
  hoursSuffix: ' hr ago',
  daysSuffix: ' days ago',
  monthsSuffix: ' mo ago',
  yearsSuffix: ' yr ago',
};

const NOW = new Date('2026-06-25T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('formatRelativeTime picks the right bucket', () => {
  assert.equal(formatRelativeTime(ago(30 * 1000), labels, NOW), 'just now');
  assert.equal(formatRelativeTime(ago(5 * MIN), labels, NOW), '5 min ago');
  assert.equal(formatRelativeTime(ago(3 * HOUR), labels, NOW), '3 hr ago');
  assert.equal(formatRelativeTime(ago(2 * DAY), labels, NOW), '2 days ago');
  assert.equal(formatRelativeTime(ago(40 * DAY), labels, NOW), '1 mo ago');
  assert.equal(formatRelativeTime(ago(400 * DAY), labels, NOW), '1 yr ago');
});

test('formatRelativeTime returns the raw string on invalid input', () => {
  assert.equal(formatRelativeTime('not-a-date', labels, NOW), 'not-a-date');
});

test('buildRelativeTimeLabels maps each field to its time.* key', () => {
  // Fake t echoes the key so we can assert the mapping.
  const built = buildRelativeTimeLabels((key) => `[${key}]`);
  assert.equal(built.justNow, `[${RELATIVE_TIME_LABEL_KEYS.justNow}]`);
  assert.equal(built.minutesSuffix, `[${RELATIVE_TIME_LABEL_KEYS.minutesSuffix}]`);
  assert.equal(built.hoursSuffix, `[${RELATIVE_TIME_LABEL_KEYS.hoursSuffix}]`);
  assert.equal(built.daysSuffix, `[${RELATIVE_TIME_LABEL_KEYS.daysSuffix}]`);
  assert.equal(built.monthsSuffix, `[${RELATIVE_TIME_LABEL_KEYS.monthsSuffix}]`);
  assert.equal(built.yearsSuffix, `[${RELATIVE_TIME_LABEL_KEYS.yearsSuffix}]`);
});
