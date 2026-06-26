// 投票選項百分比的共用計算（純函式）。
// 多個播放頁元件原先各自內嵌 `total > 0 ? Math.round(votes/total*100) : 0`，收斂於此。

/** 回傳某選項佔總票數的整數百分比；總票數 ≤ 0 時回 0。 */
export function pollOptionPercent(votes: number, total: number): number {
  return total > 0 ? Math.round((votes / total) * 100) : 0;
}
