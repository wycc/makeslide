import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRemainingSeconds } from './remainingTime';

const pages = (durations: Array<number | null>) =>
  durations.map((d) => ({ audio_duration_seconds: d }));

test('null/undefined pages 回傳 null', () => {
  assert.equal(computeRemainingSeconds(null, 0, 0, 10), null);
  assert.equal(computeRemainingSeconds(undefined, 0, 0, 10), null);
});

test('目前頁剩餘 + 之後各頁音訊總和', () => {
  // 3 頁，目前在第 0 頁，duration=10、currentTime=4 → 目前剩 6；之後 20+30=50 → 56
  assert.equal(computeRemainingSeconds(pages([10, 20, 30]), 0, 4, 10), 56);
});

test('只計算目前頁之後的頁（不含目前與更早頁）', () => {
  // 目前在第 1 頁，之後只有第 2 頁(30)；目前剩 duration5-time2=3 → 33
  assert.equal(computeRemainingSeconds(pages([10, 20, 30]), 1, 2, 5), 33);
});

test('duration <= 0（未知）時目前頁剩餘以 0 計', () => {
  // 目前在第 0 頁、duration=0 → 目前剩 0；之後 20+30=50
  assert.equal(computeRemainingSeconds(pages([10, 20, 30]), 0, 0, 0), 50);
});

test('currentTime 超過 duration 時目前頁剩餘夾在 0', () => {
  // 目前剩 max(0, 10-15)=0；之後 20 → 20
  assert.equal(computeRemainingSeconds(pages([10, 20]), 0, 15, 10), 20);
});

test('缺少 audio_duration_seconds 的頁以 0 計', () => {
  // 之後 null + 30 → 30；目前剩 0（duration 0）
  assert.equal(computeRemainingSeconds(pages([10, null, 30]), 0, 0, 0), 30);
});

test('總和為 0 時回傳 null', () => {
  // 最後一頁、duration 0、無後續頁 → 0 → null
  assert.equal(computeRemainingSeconds(pages([10, 20]), 1, 0, 0), null);
});
