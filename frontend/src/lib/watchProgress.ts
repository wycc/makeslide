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
