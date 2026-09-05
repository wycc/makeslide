/**
 * 頁面備註的字數上限。必須與後端 `detail.ts` 更新備註端點的 zod schema
 * （`z.string().max(5000)`）一致——前端 `<textarea maxLength>` 與長度提示用它把關，
 * 後端做最終驗證，兩邊一致才不會出現「前端擋不住、後端回 400」的落差。
 */
export const MAX_PAGE_NOTE_LENGTH = 5000;
