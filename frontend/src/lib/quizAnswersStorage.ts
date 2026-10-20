/**
 * 學生作答內容的本機暫存（使用者回報，2026-10-20）：作答原本只放在 React state，分頁被手機系統回收、
 * 關掉瀏覽器再從 LINE 重開連結，回來都得整份重做。改成每次改動就寫進 localStorage，重進同一場測驗
 * 時還原。鍵同監考旗標：quizId:quizSessionId——老師重開一場就是新鍵，不會把上一場的答案帶進來。
 */
export type StudentAnswers = Record<string, number[]>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIX = 'makeslide.quiz_answers.';

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    /* 隱私模式等存取被拒：不暫存 */
  }
  return null;
}

/** 本場測驗的暫存鍵；沒有場次 id（尚未加入同步）就不暫存，回傳 null。 */
export function quizAnswersKey(quizId: number, sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  return `${PREFIX}${quizId}:${sessionId}`;
}

/** 讀回暫存的作答；沒有、壞掉或形狀不對都回 null（呼叫端維持空白作答）。 */
export function readStoredQuizAnswers(key: string, storage?: StorageLike): StudentAnswers | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: StudentAnswers = {};
    for (const [qid, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const indices = value.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0);
      out[qid] = indices;
    }
    return out;
  } catch {
    return null;
  }
}

export function writeStoredQuizAnswers(key: string, answers: StudentAnswers, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(answers));
  } catch {
    /* 容量滿或被拒：只影響重進時的還原，不阻斷作答 */
  }
}

export function clearStoredQuizAnswers(key: string, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}
