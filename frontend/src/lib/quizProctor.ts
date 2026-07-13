// 測驗監考（proctor）純邏輯：與 React 無關，方便單元測試。負責
// (1) 違規次數判定、(2) 去抖動（把同一動作連帶觸發的多個事件併為一次違規）、
// (3) 「同一次測驗一旦結束不允許再進入」的鎖定狀態持久化。

/** 允許的違規次數上限；超過此數即自動交卷。預設允許一次。 */
export const DEFAULT_MAX_VIOLATIONS = 1;

/** 一次使用者動作（如 Alt+Tab）可能同時觸發 blur/visibilitychange/fullscreenchange，
 *  在此毫秒數內的後續事件視為同一次違規，不重複計數。 */
export const VIOLATION_DEBOUNCE_MS = 1200;

export type ViolationOutcome = { nextCount: number; action: 'warn' | 'lock' };

/** 依目前違規數與上限，計算加一後的結果與應採取的動作。 */
export function evaluateViolation(currentCount: number, maxAllowed = DEFAULT_MAX_VIOLATIONS): ViolationOutcome {
  const nextCount = currentCount + 1;
  return { nextCount, action: nextCount > maxAllowed ? 'lock' : 'warn' };
}

/** 是否應計入這次違規事件（距離上次違規超過去抖動時間才計入）。 */
export function shouldCountViolation(lastAt: number | null, now: number, debounceMs = VIOLATION_DEBOUNCE_MS): boolean {
  if (lastAt === null) return true;
  return now - lastAt >= debounceMs;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

const LOCKOUT_PREFIX = 'makeslide.quiz_proctor_lockout.';
const STARTED_PREFIX = 'makeslide.quiz_proctor_started.';
const FINISHED_PREFIX = 'makeslide.quiz_proctor_finished.';

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

function readFlag(prefix: string, sessionKey: string, storage?: StorageLike): boolean {
  const store = resolveStorage(storage);
  if (!store || !sessionKey) return false;
  try {
    return store.getItem(prefix + sessionKey) === '1';
  } catch {
    return false;
  }
}

function writeFlag(prefix: string, sessionKey: string, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store || !sessionKey) return;
  try {
    store.setItem(prefix + sessionKey, '1');
  } catch {
    // 儲存失敗（如隱私模式）時僅退回記憶體內狀態，不阻斷流程。
  }
}

function clearFlag(prefix: string, sessionKey: string, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store || !sessionKey) return;
  if (typeof store.removeItem !== 'function') return;
  try {
    store.removeItem(prefix + sessionKey);
  } catch {
    // 清除失敗時維持既有鎖定狀態，不阻斷其他流程。
  }
}

/** 本次測驗（以 sessionKey 唯一標示）是否已被鎖定、不允許再進入。 */
export function isQuizLockedOut(sessionKey: string, storage?: StorageLike): boolean {
  return readFlag(LOCKOUT_PREFIX, sessionKey, storage);
}

/** 標記本次測驗為已鎖定（自動交卷或正常交卷後呼叫），使重整/重新進入仍被擋下。 */
export function markQuizLockedOut(sessionKey: string, storage?: StorageLike): void {
  writeFlag(LOCKOUT_PREFIX, sessionKey, storage);
}

/** 本次測驗是否已被某個頁面實例開始過（用於偵測重整後重新進入）。 */
export function isQuizStarted(sessionKey: string, storage?: StorageLike): boolean {
  return readFlag(STARTED_PREFIX, sessionKey, storage);
}

/** 學生按下同意開始作答時標記；重整或重新載入後 isQuizStarted 為真即擋下再次進入。 */
export function markQuizStarted(sessionKey: string, storage?: StorageLike): void {
  writeFlag(STARTED_PREFIX, sessionKey, storage);
}

/** 本次測驗是否已由學生主動「完成作答並離開」。用於離開後不再被自動導回作答頁。 */
export function isQuizFinished(sessionKey: string, storage?: StorageLike): boolean {
  return readFlag(FINISHED_PREFIX, sessionKey, storage);
}

/** 學生按下「完成作答並離開」時標記；使離開後 PlayPage 不再自動導回、重新進入顯示已完成。 */
export function markQuizFinished(sessionKey: string, storage?: StorageLike): void {
  writeFlag(FINISHED_PREFIX, sessionKey, storage);
}

/** 本次測驗對該學生是否已結束（被鎖定或已主動完成離開）。已結束後不應再回報作答進度，
 *  避免把 master 端已顯示的「已完成」翻回「作答中」而讓「允許重新進入」按鈕消失。 */
export function isQuizSessionEnded(sessionKey: string, storage?: StorageLike): boolean {
  return isQuizLockedOut(sessionKey, storage) || isQuizFinished(sessionKey, storage);
}

/** 老師允許重新進入時，清除本次測驗的開始／完成／鎖定旗標。 */
export function clearQuizProctorState(sessionKey: string, storage?: StorageLike): void {
  clearFlag(LOCKOUT_PREFIX, sessionKey, storage);
  clearFlag(STARTED_PREFIX, sessionKey, storage);
  clearFlag(FINISHED_PREFIX, sessionKey, storage);
}
