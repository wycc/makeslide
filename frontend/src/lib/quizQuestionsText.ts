// 測驗題目輸出為純文字（純函式，供 QuizBuilderPage 的「複製題目」使用）。

export interface FormattableQuizQuestion {
  question: string;
  options: { text: string }[];
  answer_indices: number[];
  explanation?: string;
}

/** formatQuizQuestionsText 所需的可翻譯字串；由元件以 i18n 注入，使本函式維持純粹可測。 */
export interface QuizQuestionsTextLabels {
  /** 解析行的前綴標籤，例如「解析：」。 */
  explanationLabel: string;
}

/**
 * 把題目清單轉成純文字：每題 `N. 題幹`，選項以 `  A. 文字`（正解附 ` ✓`），
 * 有解析時附一行 `   {explanationLabel}{解析}`；題目間以空行分隔。
 * 純函式：解析標籤由 labels 注入。清單為空時回傳空字串。
 */
export function formatQuizQuestionsText<T extends FormattableQuizQuestion>(questions: T[], labels: QuizQuestionsTextLabels): string {
  return questions
    .map((q, i) => {
      const opts = q.options
        .map((o, oi) => `  ${String.fromCharCode(65 + oi)}. ${o.text}${q.answer_indices.includes(oi) ? ' ✓' : ''}`)
        .join('\n');
      const explanation = q.explanation ? `\n   ${labels.explanationLabel}${q.explanation}` : '';
      return `${i + 1}. ${q.question}\n${opts}${explanation}`;
    })
    .join('\n\n');
}
