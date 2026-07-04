// 從 AI 導師的回答文字中擷取「引用的頁碼」，供播放頁在答案下方顯示可點擊的
// 「跳至第 N 頁」捷徑。
//
// 後端 /ask 的 system prompt 要求模型引用其他頁面時以「（第 N 頁）」「（第 N 頁逐字稿）」
// 標示（引用原始來源全文則標「（原始來源）」、不含頁碼）。這裡以寬鬆的「第 N 頁」樣式
// 掃描全文，抓出所有被引用的頁碼，回傳「升冪、去重、正整數」的清單。是否落在有效頁數
// 範圍、是否排除目前頁，交由呼叫端（元件）依 deckPages 決定，本函式維持純粹。

// 允許「第3頁」「第 3 頁」「第  12  頁」等空白變化；只取阿拉伯數字頁碼。
const PAGE_CITATION_RE = /第\s*(\d+)\s*頁/g;

export function extractCitedPages(text: string): number[] {
  if (!text) return [];
  const seen = new Set<number>();
  // 每次呼叫用新的 lastIndex 起點；因為是模組層級帶 g 的 regex，先歸零以防重入殘留。
  PAGE_CITATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAGE_CITATION_RE.exec(text)) !== null) {
    const digits = m[1];
    if (!digits) continue;
    const n = Number.parseInt(digits, 10);
    // 頁碼為 1 起算的正整數；忽略 0 或解析失敗者。
    if (Number.isInteger(n) && n > 0) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}
