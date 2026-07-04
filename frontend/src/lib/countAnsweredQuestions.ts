// 計算學生已作答的題數（共用純函式）。
//
// 去重自 `QuizBuilderPage` 三處內聯 `questions.filter((q) => (answers[q.id] ?? []).length > 0).length`
// （送出前檢查、進度顯示等）。一題只要有至少一個選取答案即算已作答。

export function countAnsweredQuestions<Q extends { id: string }>(
  questions: readonly Q[],
  answers: Record<string, readonly number[] | undefined>,
): number {
  return questions.filter((q) => (answers[q.id] ?? []).length > 0).length;
}
