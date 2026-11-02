/** 學生作答的本機草稿：重整、當掉、切 App 被瀏覽器回收後仍能把答案接回來。
 *  以「測驗 id＋場次 id」為鍵（與 quizProctor 的旗標同一組 sessionKey），換場次自然不會互相污染。 */

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

const DRAFT_PREFIX = 'makeslide.quiz_answer_draft.';

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

/** 只留「題目 id → 選項索引陣列」的形狀；壞掉或不是這個形狀的資料一律丟掉（回空）。 */
function sanitize(parsed: unknown): Record<string, number[]> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, number[]> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const indices = value.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0);
    if (indices.length > 0) out[key] = [...new Set(indices)];
  }
  return out;
}

export function readQuizAnswerDraft(sessionKey: string, storage?: StorageLike): Record<string, number[]> {
  const store = resolveStorage(storage);
  if (!store || !sessionKey) return {};
  try {
    const raw = store.getItem(DRAFT_PREFIX + sessionKey);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeQuizAnswerDraft(sessionKey: string, answers: Record<string, number[]>, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store || !sessionKey) return;
  try {
    store.setItem(DRAFT_PREFIX + sessionKey, JSON.stringify(answers));
  } catch {
    // 配額用盡或隱私模式：作答仍在記憶體裡，只是重整後救不回來，不阻斷作答。
  }
}

export function clearQuizAnswerDraft(sessionKey: string, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store || !sessionKey || typeof store.removeItem !== 'function') return;
  try {
    store.removeItem(DRAFT_PREFIX + sessionKey);
  } catch {
    // 清不掉也無妨：下一次同一把鍵的草稿會直接覆寫。
  }
}

/** 這份作答是不是一題都沒答（用來判斷「不要寫入空白卷」）。 */
export function isBlankAnswerSheet(answers: Record<string, number[]>): boolean {
  return Object.values(answers).every((selected) => !selected || selected.length === 0);
}
