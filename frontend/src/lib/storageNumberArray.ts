// 從 localStorage 安全讀取一個「數字陣列」狀態（供書籤、重點頁等以 JSON 陣列存放者）。
//
// 去重自 `PlayPage` 的 bookmarks／importantPages 兩個 useState 初始化：讀值→`JSON.parse`→
// 確認是陣列。非法 JSON／非陣列／缺值皆回 `[]`。另外過濾非數字元素（比原本的
// `as number[]` 直接轉型更穩健，避免損壞資料流入頁碼運算）。可注入 storage 以便測試。

// 通用：從 storage 安全讀出一個 JSON 陣列（回 `unknown[]`），非法 JSON／缺值／非陣列／
// getItem 拋錯皆回 `[]`。呼叫端自行過濾/轉換元素型別。
export function readJsonArrayFromStorage(
  key: string,
  storage: Pick<Storage, 'getItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage,
): unknown[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readNumberArrayFromStorage(
  key: string,
  storage?: Pick<Storage, 'getItem'>,
): number[] {
  return readJsonArrayFromStorage(key, storage).filter((x): x is number => typeof x === 'number');
}
