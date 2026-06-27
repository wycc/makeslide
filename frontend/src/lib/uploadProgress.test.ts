import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadProgressPercent } from './uploadProgress';

test('一般進度四捨五入為整數百分比', () => {
  assert.equal(uploadProgressPercent(0, 100), 0);
  assert.equal(uploadProgressPercent(50, 100), 50);
  assert.equal(uploadProgressPercent(100, 100), 100);
  assert.equal(uploadProgressPercent(1, 3), 33);
  assert.equal(uploadProgressPercent(2, 3), 67);
});

test('分母無效（0／負值／NaN）回傳 0，不產生 NaN/Infinity', () => {
  assert.equal(uploadProgressPercent(10, 0), 0);
  assert.equal(uploadProgressPercent(10, -5), 0);
  assert.equal(uploadProgressPercent(10, NaN), 0);
});

test('loaded 超過 total 時夾在 100', () => {
  assert.equal(uploadProgressPercent(150, 100), 100);
});

test('與舊內聯寫法在分母 > 0 時輸出一致', () => {
  const oldInline = (loaded: number, total: number) => Math.round((loaded / total) * 100);
  for (const [l, t] of [[0, 100], [37, 100], [1, 3], [999, 1000], [5, 7]] as const) {
    assert.equal(uploadProgressPercent(l, t), oldInline(l, t));
  }
});
