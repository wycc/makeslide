// 切換測驗題某個選項的勾選狀態（共用純函式）。
//
// 去重自 `QuizBuilderPage` 的 `toggleAnswer`（設定正解）與 `toggleStudentAnswer`（作答），
// 兩者原本各自內聯同一段「單選→只留該選項；複選→用 Set 加/減後排序」邏輯、無測試。
//
// - `single`（單選）：直接回傳只含該選項的陣列。
// - 複選：加入/移除該 index，回傳去重且升冪排序的新陣列（不改動輸入）。

export function toggleAnswerIndex(current: readonly number[], index: number, single: boolean): number[] {
  if (single) return [index];
  const set = new Set(current);
  if (set.has(index)) set.delete(index);
  else set.add(index);
  return Array.from(set).sort((a, b) => a - b);
}
