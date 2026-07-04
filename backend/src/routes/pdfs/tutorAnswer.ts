// AI 導師（PageAskPanel）回答文字的收尾處理：換行正規化 + 空答保底。
//
// 1) 換行正規化：模型常把換行以字面 `\n`（反斜線+n）輸出而非真正的換行字元，導致前端
//    顯示成「\n\n」而非分行。只在「跳脫字母後面不是英文字母」時才還原成換行，避免誤傷
//    LaTeX 指令（如 \nabla、\nu、\rho、\right、\text、\times——後者開頭就是 \t/\n/\r）。
// 2) 空答保底：正規化並 trim 後若為空字串（模型偶爾回空或整段被 trim 掉），回傳一段固定
//    提示，避免前端顯示空白的導師泡泡；也涵蓋「查無資訊」時模型給空答的情況。

// 查無資訊／空答時顯示的固定提示（繁體中文，與導師回答語言一致）。
export const TUTOR_NO_ANSWER_FALLBACK =
  '很抱歉，我在這份教材（投影片、逐字稿與原始來源）中找不到可以回答這個問題的相關資訊。你可以換個問法，或到相關頁面再問一次。';

export function finalizeTutorAnswer(raw: string): string {
  const normalized = raw
    .replace(/\\r?\\n\\r?\\n/g, '\n\n')
    .replace(/\\r\\n|\\n(?![A-Za-z])|\\r(?![A-Za-z])/g, '\n')
    .trim();
  return normalized || TUTOR_NO_ANSWER_FALLBACK;
}
