// 判定「這一頁是否視為已完整聽過」的純函式，供 useWatchProgress 在換頁/卸載時呼叫。
//
// 刻意採用「多種不同訊號交叉比對」而非只看單一訊號（呼應 LOOP.md 對這個功能的要求）：
// - onEndedFired：音訊是否真的自然播放到結尾（不是使用者提早切頁離開）。
// - listenedMs / durationMs：即使 onEnded 觸發，仍要求實際「正在播放且分頁可見」累積的時間
//   達到語音長度的一定比例，允許使用者倒退重聽造成的些微落差。
// - tabHiddenMs / durationMs：分頁被切到背景（使用者離開電腦、切到別的視窗）的時間不能佔
//   語音長度太高的比例，避免「開著分頁但人不在」被誤判成認真看完。
export interface EvaluateWatchCompletionInput {
  onEndedFired: boolean;
  listenedMs: number;
  tabHiddenMs: number;
  durationMs: number | null;
}

const MIN_LISTENED_RATIO = 0.85;
const MAX_TAB_HIDDEN_RATIO = 0.15;

export function evaluateWatchCompletion({
  onEndedFired,
  listenedMs,
  tabHiddenMs,
  durationMs,
}: EvaluateWatchCompletionInput): boolean {
  // 沒有語音的頁面：沒有音訊長度可比對，刻意保守地不判定為完成（避免亂猜）。
  // 未來若要支援靜音頁的完成判定，可在這裡擴充。
  if (durationMs === null) return false;
  if (!onEndedFired) return false;
  if (listenedMs < durationMs * MIN_LISTENED_RATIO) return false;
  if (tabHiddenMs > durationMs * MAX_TAB_HIDDEN_RATIO) return false;
  return true;
}

// ── Sidebar watch-progress badge helpers ──────────────────────────────────────
//
// 純函式，供側邊欄縮圖徽章（只有 owner 看得到的每頁觀看完成率）使用，輸入為後端
// `GET /api/pdfs/:id/watch-progress` 回傳的單頁聚合統計（見
// `frontend/src/lib/api/pdfs.ts` 的 `PageWatchProgressStats`）。
export interface PageWatchProgressSummary {
  total_viewers: number;
  completed_viewers: number;
  avg_listened_ratio: number | null;
}

/** 將任意百分比夾到 0-100 的整數區間；非有限值回傳 null。 */
function clampPercent(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** 完成率（0-100 的整數百分比）。`total_viewers <= 0` 時回傳 null，代表沒有足夠資料可顯示。 */
export function calculateWatchProgressPercent(stats: PageWatchProgressSummary): number | null {
  if (stats.total_viewers <= 0) return null;
  // 資料異常（completed_viewers > total_viewers）時夾在 100，避免徽章顯示 >100%。
  return clampPercent((stats.completed_viewers / stats.total_viewers) * 100);
}

/**
 * 平均聆聽比例的整數百分比（0-100）。`ratio` 為 null 時回傳 null。
 * 使用者倒退重聽會使 listenedMs 超過語音長度、令 ratio > 1，故需夾在 100 上限，
 * 否則 tooltip 會出現「平均聆聽 130%」這種失真數字。
 */
export function calculateAvgListenedPercent(ratio: number | null): number | null {
  if (ratio == null) return null;
  return clampPercent(ratio * 100);
}

/** 縮圖徽章用的精簡顯示文字（例如 `3/5`）。回傳 null 代表沒有足夠資料可顯示徽章。 */
export function formatWatchProgressBadgeCount(stats: PageWatchProgressSummary): string | null {
  if (stats.total_viewers <= 0) return null;
  return `${stats.completed_viewers}/${stats.total_viewers}`;
}
