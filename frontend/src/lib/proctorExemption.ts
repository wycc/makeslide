// 監考的「預期中斷」豁免（使用者回報，2026-10-22）：學生在作答頁按「開啟相機」拍問答題時，
// 瀏覽器跳出相機權限提示會讓視窗失焦，Android Chrome 還會退出全螢幕，監考就把它當成「離開頁面」。
// 這類由作答頁自己發起、學生沒有離開的中斷，在進行期間（有上限）與結束後短暫寬限內不計為離開；
// 結束時通知監考元件重新檢查一次實際狀態——真的被切走了就照常開始計算。
//
// 與 React 無關的模組層狀態，讓 EssayAnswerUploader 不必知道 QuizProctorGate 的存在。

/** 單次豁免最長多久：權限提示停太久就不再豁免，避免變成「開相機就能離開」的漏洞。 */
export const EXEMPTION_MAX_MS = 20_000;
/** 豁免結束後再寬限多久：提示關閉後 focus／fullscreenchange 事件會晚一點才到。 */
export const EXEMPTION_TAIL_MS = 1_500;

interface Active {
  id: number;
  deadline: number;
}

let active: Active[] = [];
let tailUntil = 0;
let nextId = 1;
const endListeners = new Set<() => void>();

export function isProctorExempt(now = Date.now()): boolean {
  return now < tailUntil || active.some((a) => now < a.deadline);
}

/** 開始一段豁免，回傳結束函式（可重複呼叫，只生效一次）。 */
export function beginProctorExemption(now = Date.now(), maxMs = EXEMPTION_MAX_MS): (endNow?: number) => void {
  const entry: Active = { id: nextId++, deadline: now + maxMs };
  active.push(entry);
  let ended = false;
  return (endNow = Date.now()) => {
    if (ended) return;
    ended = true;
    active = active.filter((a) => a.id !== entry.id);
    tailUntil = Math.max(tailUntil, Math.min(endNow, entry.deadline) + EXEMPTION_TAIL_MS);
    endListeners.forEach((cb) => cb());
  };
}

/** 在豁免中執行一個非同步動作（例如 getUserMedia）。 */
export async function withProctorExemption<T>(fn: () => Promise<T>): Promise<T> {
  const end = beginProctorExemption();
  try {
    return await fn();
  } finally {
    end();
  }
}

/** 豁免結束時通知（監考元件據此在寬限後重新檢查頁面狀態）。 */
export function onProctorExemptionEnd(cb: () => void): () => void {
  endListeners.add(cb);
  return () => endListeners.delete(cb);
}

/** 測試用：清掉所有狀態。 */
export function __resetProctorExemptionForTest(): void {
  active = [];
  tailUntil = 0;
  endListeners.clear();
}
