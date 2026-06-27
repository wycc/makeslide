import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stepSlideImageScale,
  SLIDE_IMAGE_SCALE_MIN,
  SLIDE_IMAGE_SCALE_MAX,
  SLIDE_IMAGE_SCALE_STEP,
} from './slideImageScale';

const inc = (s: number) => stepSlideImageScale(s, SLIDE_IMAGE_SCALE_STEP);
const dec = (s: number) => stepSlideImageScale(s, -SLIDE_IMAGE_SCALE_STEP);

test('放大／縮小一步並消除浮點誤差', () => {
  assert.equal(inc(1), 1.1);
  assert.equal(dec(1), 0.9);
  // 0.7 + 0.1 在浮點下為 0.7999999999999999，toFixed 後應為 0.8
  assert.equal(inc(0.7), 0.8);
});

test('縮小不低於下限 0.65', () => {
  assert.equal(dec(0.7), SLIDE_IMAGE_SCALE_MIN);
  assert.equal(dec(0.65), SLIDE_IMAGE_SCALE_MIN);
});

test('放大不高於上限 1.35', () => {
  assert.equal(inc(1.3), SLIDE_IMAGE_SCALE_MAX);
  assert.equal(inc(1.35), SLIDE_IMAGE_SCALE_MAX);
});

test('與舊內聯寫法輸出一致', () => {
  const oldDec = (s: number) => Math.max(0.65, Number((s - 0.1).toFixed(2)));
  const oldInc = (s: number) => Math.min(1.35, Number((s + 0.1).toFixed(2)));
  for (const s of [0.65, 0.7, 0.85, 1, 1.05, 1.25, 1.3, 1.35]) {
    assert.equal(dec(s), oldDec(s));
    assert.equal(inc(s), oldInc(s));
  }
});
