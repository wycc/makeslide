// 從 localStorage 安全讀取一個「數字陣列」狀態（供書籤、重點頁等以 JSON 陣列存放者）。
//
// 去重自 `PlayPage` 的 bookmarks／importantPages 兩個 useState 初始化：讀值→`JSON.parse`→
// 確認是陣列。非法 JSON／非陣列／缺值皆回 `[]`。另外過濾非數字元素（比原本的
// `as number[]` 直接轉型更穩健，避免損壞資料流入頁碼運算）。可注入 storage 以便測試。

export function readNumberArrayFromStorage(
  key: string,
  storage: Pick<Storage, 'getItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage,
): number[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}
