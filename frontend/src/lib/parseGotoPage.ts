// 跳頁輸入的驗證（純函式，供播放頁跳頁框使用）。

/**
 * 解析跳頁輸入字串：回傳合法的 1-based 頁碼，或 null（非數字、空白、≤0、超出
 * 總頁數、或小數捨去後仍越界）。`Number` 會把空字串視為 0、非數字視為 NaN，
 * 兩者皆落入 null。
 */
export function parseGotoPage(input: string, totalPages: number): number | null {
  const n = Math.floor(Number(input));
  return Number.isFinite(n) && n >= 1 && n <= totalPages ? n : null;
}
