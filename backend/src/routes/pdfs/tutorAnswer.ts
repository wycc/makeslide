import type { AppLanguage } from '../../services/aiSettings';
import { tutorNoAnswerFallback as tutorNoAnswerFallbackFor } from '../../services/contentLanguage';
// AI 導師（PageAskPanel）回答文字的收尾處理：換行正規化 + 空答保底。
//
// 1) 換行正規化：模型常把換行以字面 `\n`（反斜線+n）輸出而非真正的換行字元，導致前端
//    顯示成「\n\n」而非分行。只在「跳脫字母後面不是英文字母」時才還原成換行，避免誤傷
//    LaTeX 指令（如 \nabla、\nu、\rho、\right、\text、\times——後者開頭就是 \t/\n/\r）。
// 2) 空答保底：正規化並 trim 後若為空字串（模型偶爾回空或整段被 trim 掉），回傳一段固定
//    提示，避免前端顯示空白的導師泡泡；也涵蓋「查無資訊」時模型給空答的情況。

// 查無資訊／空答時顯示的固定提示。這段文字會**原樣顯示給學生**，所以它必須跟著「輸出語言」
// 設定走——導師用英文回答、卻以中文說「找不到資訊」，是同一個對話裡兩種語言。
export { tutorNoAnswerFallback } from '../../services/contentLanguage';

/**
 * @param language 導師的輸出語言；省略時維持繁體中文，讓既有呼叫端與測試不受影響。
 */
export function finalizeTutorAnswer(raw: string, language: AppLanguage = 'zh-TW'): string {
  const normalized = raw
    .replace(/\\r?\\n\\r?\\n/g, '\n\n')
    .replace(/\\r\\n|\\n(?![A-Za-z])|\\r(?![A-Za-z])/g, '\n')
    .trim();
  return normalized || tutorNoAnswerFallbackFor(language);
}
