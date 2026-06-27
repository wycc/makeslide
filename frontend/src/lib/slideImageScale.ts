import { clamp } from './clamp';

/** 播放頁投影片圖片縮放比例的允許範圍與步進。 */
export const SLIDE_IMAGE_SCALE_MIN = 0.65;
export const SLIDE_IMAGE_SCALE_MAX = 1.35;
export const SLIDE_IMAGE_SCALE_STEP = 0.1;

/**
 * 將縮放比例調整 `delta`（正放大、負縮小）後夾在允許範圍內。
 *
 * 先前 `PlayPageHeader` 的放大／縮小按鈕各自內嵌
 * `Math.max(0.65, Number((scale - 0.1).toFixed(2)))` 與
 * `Math.min(1.35, Number((scale + 0.1).toFixed(2)))`，magic number 散落。
 * 收斂為共用常數與純函式：先 `toFixed(2)` 消除浮點誤差（如 0.7000000000001），
 * 再以共用 `clamp` 夾在 [MIN, MAX]，與原寫法行為一致。
 */
export function stepSlideImageScale(scale: number, delta: number): number {
  const next = Number((scale + delta).toFixed(2));
  return clamp(next, SLIDE_IMAGE_SCALE_MIN, SLIDE_IMAGE_SCALE_MAX);
}
