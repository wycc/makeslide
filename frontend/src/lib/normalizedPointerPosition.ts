// 由指標事件座標與元素矩形，算出「元素內的正規化 [0,1] 位置」（共用純函式）。
//
// 去重自播放頁/遙控頁多處 onPointerMove/onPointerUp 的內聯
// `Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))`（x、y 各一份）。沿用既有
// `clamp`，語意等價（含 width/height 為 0 時的 NaN 行為，與原內聯相同）。

import { clamp } from './clamp';

export interface DomRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function normalizedPointerPosition(clientX: number, clientY: number, rect: DomRectLike): { x: number; y: number } {
  return {
    x: clamp((clientX - rect.left) / rect.width, 0, 1),
    y: clamp((clientY - rect.top) / rect.height, 0, 1),
  };
}
