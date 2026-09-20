import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageSeconds, formatUsageDuration, learnerDisplayName, weekRangeLabel } from './tutorQuizUsage';

const UNITS = { hour: '小時', minute: '分', second: '秒' };

test('formatUsageDuration 依長度挑單位：秒、分秒、時分', () => {
  assert.equal(formatUsageDuration(0, UNITS), '0 秒');
  assert.equal(formatUsageDuration(45, UNITS), '45 秒');
  assert.equal(formatUsageDuration(60, UNITS), '1 分');
  assert.equal(formatUsageDuration(125, UNITS), '2 分 5 秒');
  assert.equal(formatUsageDuration(3600, UNITS), '1 小時');
  // 一小時以上不寫秒：統計表裡沒有人在意那個 07 秒。
  assert.equal(formatUsageDuration(3 * 3600 + 12 * 60 + 7, UNITS), '3 小時 12 分');
});

test('formatUsageDuration 壞輸入當成零，不顯示 NaN 或負數', () => {
  assert.equal(formatUsageDuration(Number.NaN, UNITS), '0 秒');
  assert.equal(formatUsageDuration(-30, UNITS), '0 秒');
  assert.equal(formatUsageDuration(59.6, UNITS), '1 分');
});

test('averageSeconds 沒有任何一次時是 0 而不是 NaN', () => {
  assert.equal(averageSeconds(600, 4), 150);
  assert.equal(averageSeconds(600, 0), 0);
  assert.equal(averageSeconds(0, 0), 0);
});

test('weekRangeLabel 從週一日期寫出整週區間，跨月跨年都對', () => {
  assert.equal(weekRangeLabel('2026-09-07'), '2026 09/07–09/13');
  assert.equal(weekRangeLabel('2026-08-31'), '2026 08/31–09/06');
  assert.equal(weekRangeLabel('2025-12-29'), '2025 12/29–01/04');
  assert.equal(weekRangeLabel('2026-09'), '2026-09', '格式不對就原樣回傳');
});

test('learnerDisplayName 有姓名用姓名，沒有就標示匿名並附裝置末碼', () => {
  const labels = { anonymous: '匿名', unnamed: '未命名帳號' };
  assert.equal(learnerDisplayName({ display_name: '林同學', signed_in: true, device_hint: 'abc123' }, labels), '林同學');
  assert.equal(learnerDisplayName({ display_name: null, signed_in: false, device_hint: 'abc123' }, labels), '匿名 (abc123)');
  assert.equal(learnerDisplayName({ display_name: '  ', signed_in: true, device_hint: '' }, labels), '未命名帳號');
});
