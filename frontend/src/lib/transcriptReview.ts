/**
 * 將逐字稿整理成「快速檢視」用的純文字：
 * - 去除語氣提示標記（`[seriously]`、`【興奮】` 等中英方括號標註）
 * - 去除說話者標記（`Speaker 1:`、`Speaker 2：` 等，含全形冒號）
 * - 把換行與多重空白收斂成單一空白，串成連續一段，便於左右並排時閱讀
 *
 * 為純函式，方便單元測試；不改動原始逐字稿，只在檢視層套用。
 */
export function cleanTranscriptForReview(text: string | null | undefined): string {
  if (!text) return '';
  return text
    // 語氣／情緒提示：中英方括號標註
    .replace(/[[【][^\]】]*[\]】]/g, ' ')
    // 說話者標記：Speaker N: / Speaker N：
    .replace(/Speaker\s*\d+\s*[:：]/gi, ' ')
    // 換行與多重空白 → 單一空白
    .replace(/\s+/g, ' ')
    .trim();
}
