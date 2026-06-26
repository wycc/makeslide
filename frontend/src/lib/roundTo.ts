// 四捨五入到兩位小數的共用純函式。
// QuizBuilderPage 的題目／作答分數、HomePage 與 PlayPage 的預算成本顯示，
// 原先各自內嵌 `Math.round(x * 100) / 100`（共 8 處），收斂於此。

/**
 * 將數值四捨五入到小數第二位。
 * 主要用途是把浮點累加產生的微小誤差（例如 `33.33 + 33.33 + 33.34` 得到
 * `100.00000000000001`，或 `0.1 + 0.2` 得到 `0.30000000000000004`）收斂回乾淨的兩位小數。
 * 非有限輸入（NaN／Infinity）維持原本算術結果，由呼叫端自行決定如何顯示。
 */
export function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
