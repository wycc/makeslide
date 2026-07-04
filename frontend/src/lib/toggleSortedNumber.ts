// 在升冪數字清單中切換某個值：存在→移除；不存在→加入並保持升冪（共用純函式）。
//
// 去重自 `PlayPage` 的 `toggleBookmark`（書籤頁）與 `toggleImportantPage`（重點頁），兩者
// 原本各自內聯 `prev.includes(n) ? prev.filter(...) : [...prev, n].sort(...)`。輸入為切換式
// 累積、不含重複值，故沿用 filter/append 語意（不做去重），與原行為完全一致；回傳新陣列。

export function toggleSortedNumber(list: readonly number[], value: number): number[] {
  return list.includes(value)
    ? list.filter((n) => n !== value)
    : [...list, value].sort((a, b) => a - b);
}
