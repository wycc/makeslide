// AI 導師（PageAskPanel）回答的「長度／結構」控制。
//
// 原本 system prompt 一律要求「完整、不刻意精簡」，長答常過於冗長且沒有進度感。
// 此處讓前端可選「精簡（brief）」或「詳細（detailed，預設）」，各自附加一段長度指示到
// system prompt 末尾，並統一引導模型「結論先行、先給重點摘要再展開」以改善可讀性。
//
// 純函式，方便單元測試；未指定（undefined）視為 detailed，維持既有的詳盡取向。

export type AskVerbosity = 'brief' | 'detailed';

export function askVerbosityInstruction(verbosity: AskVerbosity | undefined): string {
  if (verbosity === 'brief') {
    return '【本次回答長度：精簡】請以精簡為主：先用 1～3 句點出重點摘要（結論先行），僅在必要時補充最關鍵的細節，避免冗長展開；若一兩句就能完整回答，就不要硬性加長。';
  }
  // detailed（含未指定）：維持詳盡，但先給重點摘要再展開，改善長答的可讀性。
  return '【本次回答長度：詳細】請詳盡、有條理地回答；但務必先用一兩句話點出重點摘要（結論先行），再展開完整說明與必要的例子。';
}
