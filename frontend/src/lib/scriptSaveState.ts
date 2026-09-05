// 「儲存並重生語音」按鈕能不能按，是兩件事的聯集，不是一件。
//
// 一是**逐字稿文字有沒有變**（textarea 被改過、還沒存回去）。
// 二是**語音有沒有落後於逐字稿**：AI 改寫與對話式改寫走的 rewrite-script 端點會把改寫後的
// 稿子直接寫進檔案，所以稿子等於已經存了，文字比對於是看不出差別——但語音仍是改寫前那一段。
// 只看文字差異的話，按鈕會在最需要它的時候變灰（使用者回報：改寫後按鈕沒有 enable）。

export interface ScriptSaveInput {
  /** 編輯器內容與已儲存的逐字稿不同。 */
  hasScriptChanges: boolean;
  /** 逐字稿已被改寫（可能已落檔），但語音還沒重新生成。 */
  audioOutdated: boolean;
  /** 正在存檔／重生語音。 */
  busy: boolean;
  /** 唯讀（分享觀看者、生成處理中）。 */
  readOnly: boolean;
}

/** 「儲存並重生語音」是否可按。 */
export function canSaveScript({ hasScriptChanges, audioOutdated, busy, readOnly }: ScriptSaveInput): boolean {
  if (readOnly || busy) return false;
  return hasScriptChanges || audioOutdated;
}
