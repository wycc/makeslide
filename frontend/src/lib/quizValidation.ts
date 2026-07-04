// 測驗題目完整性檢查（共用純函式）。
//
// 抽自 `QuizBuilderPage` 的 `canSave` 內聯判斷：每一題都必須有非空題幹，且——申論題（essay）
// 無須選項；其餘題型至少要有兩個非空選項。抽出以便針對「可否儲存」的規則獨立測試。
// 注意：空題目陣列會回 `true`（`every` 的語意），呼叫端另行檢查「至少一題」。

export interface ValidatableQuestion {
  question: string;
  type: string;
  options: readonly { text: string }[];
}

export function allQuestionsComplete(questions: readonly ValidatableQuestion[]): boolean {
  return questions.every(
    (q) => q.question.trim() !== '' && (q.type === 'essay' || q.options.filter((o) => o.text.trim() !== '').length >= 2),
  );
}
