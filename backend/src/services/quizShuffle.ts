/**
 * 打亂 AI 產生的選擇題選項。
 *
 * 為什麼需要：語言模型寫選擇題時，正確答案有很強的機率被放在第一個選項——使用者實際看到的
 * 就是「答案幾乎都是 A」。這不是提示詞寫得不夠清楚的問題（叫模型「隨機排列」並不可靠），
 * 所以在存進資料庫之前由我們自己重排，正解位置才真的是隨機的。
 *
 * 純函式並可注入亂數來源，測試才能斷言「打亂後正解確實跟著移動」而不是碰運氣。
 */

export interface ShuffledChoices<T> {
  options: T[];
  /** 打亂後的正解索引，順序與輸入的 answerIndices 對應。 */
  answerIndices: number[];
}

/**
 * Fisher-Yates 洗牌，並把每個正解索引映射到新位置。支援複選（多個正解）。
 *
 * 選項少於兩個、或任何一個正解索引超出範圍時，原樣回傳——那種資料本來就有問題，
 * 這裡再動它只會把「壞掉的題目」變成「壞掉且對不起來的題目」。
 */
export function shuffleChoices<T>(
  options: readonly T[],
  answerIndices: readonly number[],
  rng: () => number = Math.random,
): ShuffledChoices<T> {
  const valid =
    options.length >= 2 &&
    answerIndices.length > 0 &&
    answerIndices.every((i) => Number.isInteger(i) && i >= 0 && i < options.length);
  if (!valid) return { options: [...options], answerIndices: [...answerIndices] };

  // order[newPosition] = 原本的索引。索引全部由 options.map 產生，必定在範圍內，
  // 故以下的取值斷言是安全的（專案開啟 noUncheckedIndexedAccess）。
  const order = options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i] as number;
    order[i] = order[j] as number;
    order[j] = tmp;
  }

  return {
    options: order.map((original) => options[original] as T),
    // 保持與輸入相同的順序，複選題的正解集合才不會因為排序而變得難以比對
    answerIndices: answerIndices.map((original) => order.indexOf(original)),
  };
}

/** 單選題的便利包裝：回傳打亂後的選項與新的正解索引。 */
export function shuffleSingleChoice<T>(
  options: readonly T[],
  correctIndex: number,
  rng: () => number = Math.random,
): { options: T[]; correctIndex: number } {
  const result = shuffleChoices(options, [correctIndex], rng);
  return { options: result.options, correctIndex: result.answerIndices[0] ?? correctIndex };
}
