// 全域搜尋的「最近關鍵字」記錄（localStorage，含非瀏覽器環境防護）。
// 慣例沿用 i18n.ts / viewerId.ts 的 `typeof window` 檢查。

import { hasLocalStorage } from './hasLocalStorage';

const RECENT_SEARCHES_KEY = 'makeslide.recentSearches';
const MAX_RECENT = 8;

/** 讀取最近搜尋（最新在前）；壞值或非瀏覽器環境回 []。 */
export function getRecentSearches(): string[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/**
 * 新增一筆搜尋並回傳更新後的清單（最新在前、去重不分大小寫、上限 MAX_RECENT）。
 * 空白查詢忽略並回傳現有清單。非瀏覽器環境僅回傳計算結果、不寫入。
 */
export function addRecentSearch(query: string): string[] {
  const trimmed = query.trim();
  const existing = getRecentSearches();
  if (!trimmed) return existing;
  const lower = trimmed.toLowerCase();
  const next = [trimmed, ...existing.filter((q) => q.toLowerCase() !== lower)].slice(0, MAX_RECENT);
  if (hasLocalStorage()) {
    try {
      window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      // 寫入失敗（如配額）時仍回傳計算結果，呼叫端可照常顯示。
    }
  }
  return next;
}

/** 清除所有最近搜尋。 */
export function clearRecentSearches(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // ignore
  }
}
