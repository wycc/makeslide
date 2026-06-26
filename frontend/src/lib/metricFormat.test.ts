import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMetricDurationMs, formatMetricCostUsd } from './metricFormat';

test('formatMetricDurationMs shows a dash for missing or non-finite input', () => {
  assert.equal(formatMetricDurationMs(null, 's'), '—');
  assert.equal(formatMetricDurationMs(Number.NaN, 's'), '—');
  assert.equal(formatMetricDurationMs(Number.POSITIVE_INFINITY, 's'), '—');
});

test('formatMetricDurationMs shows milliseconds below 1000ms', () => {
  assert.equal(formatMetricDurationMs(0, 's'), '0 ms');
  assert.equal(formatMetricDurationMs(999, 's'), '999 ms');
});

test('formatMetricDurationMs shows seconds with one decimal at or above 1000ms', () => {
  assert.equal(formatMetricDurationMs(1000, 's'), '1s');
  assert.equal(formatMetricDurationMs(1500, 's'), '1.5s');
  assert.equal(formatMetricDurationMs(1234, 's'), '1.2s'); // round(12.34)/10 = 1.2
  assert.equal(formatMetricDurationMs(2500, '秒'), '2.5秒'); // 後綴可為 i18n 字串
});

test('formatMetricCostUsd returns the unknown label for missing or non-finite input', () => {
  assert.equal(formatMetricCostUsd(null, 'unknown'), 'unknown');
  assert.equal(formatMetricCostUsd(Number.NaN, 'unknown'), 'unknown');
});

test('formatMetricCostUsd renders six decimal places with a US$ prefix', () => {
  assert.equal(formatMetricCostUsd(0, 'unknown'), 'US$0.000000');
  assert.equal(formatMetricCostUsd(0.123456789, 'unknown'), 'US$0.123457');
  assert.equal(formatMetricCostUsd(12.5, 'unknown'), 'US$12.500000');
});
