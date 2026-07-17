/**
 * 頁面評論的字數上限。必須與後端 comments.ts 的 MAX_COMMENT_LENGTH 一致——
 * 前端 <textarea maxLength> 與長度提示用它把關，後端 schema 用同一數字做最終驗證，
 * 兩邊一致才不會出現「前端擋不住、後端回 400」或「前端擋太多」的落差。
 * 原為 2000，太小以致較長內容（例如把 AI 導師詳解存成評論）被截斷、無法完整保留，
 * 放寬到 20000，仍保留上限以防濫用。
 */
export const MAX_COMMENT_LENGTH = 20000;
