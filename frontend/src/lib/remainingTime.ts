/** `computeRemainingSeconds` 只需頁面的音訊長度欄位。 */
type RemainingPage = { audio_duration_seconds?: number | null };

/**
 * 估算從目前播放位置到簡報結束的剩餘秒數：目前頁的剩餘（`duration - currentTime`，
 * 夾在 0 以上；`duration <= 0`〔未知〕時以 0 計）加上之後每頁的 `audio_duration_seconds`
 * 總和（缺值以 0 計）。
 *
 * 原為 `PlayPageSlidePanel` 內聯的 `useMemo` 計算，無測試。收斂為純函式。
 * - `pages` 為 null/undefined（尚未載入）時回 `null`。
 * - 總和為 0 時回 `null`（呼叫端據此隱藏剩餘時間）。
 */
export function computeRemainingSeconds(
  pages: ReadonlyArray<RemainingPage> | null | undefined,
  currentIdx: number,
  currentTime: number,
  duration: number,
): number | null {
  if (!pages) return null;
  const currentPageRemaining = duration > 0 ? Math.max(0, duration - currentTime) : 0;
  const futureSeconds = pages
    .slice(currentIdx + 1)
    .reduce((sum, p) => sum + (p.audio_duration_seconds ?? 0), 0);
  const total = currentPageRemaining + futureSeconds;
  return total > 0 ? total : null;
}
