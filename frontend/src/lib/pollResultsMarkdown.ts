// 投票結果輸出為 Markdown（純函式，供播放頁投票區「複製」使用）。

export interface MarkdownablePollOption {
  text: string;
  votes: number;
}

export interface MarkdownablePoll {
  question: string;
  options: MarkdownablePollOption[];
  total_votes: number;
}

/** formatPollResultsMarkdown 所需的可翻譯字串；由元件以 i18n 注入，使本函式維持純粹可測。 */
export interface PollResultsMarkdownLabels {
  heading: string;
  /** 票數單位，例如「票」/「votes」。 */
  votesUnit: string;
}

/**
 * 將投票結果輸出為 Markdown：每個 poll 一個 `## 問題` 區段，各選項一行
 * `- 選項：N 單位（X%）`。百分比為 `round(votes/total*100)`，total 為 0 時 0%。
 * 純函式：顯示文字由 labels 注入。清單為空時回傳空字串。
 */
export function formatPollResultsMarkdown<T extends MarkdownablePoll>(polls: T[], labels: PollResultsMarkdownLabels): string {
  if (polls.length === 0) return '';
  const lines = [`# ${labels.heading}`];
  for (const poll of polls) {
    lines.push('', `## ${poll.question}`);
    for (const opt of poll.options) {
      const pct = poll.total_votes > 0 ? Math.round((opt.votes / poll.total_votes) * 100) : 0;
      lines.push(`- ${opt.text}：${opt.votes} ${labels.votesUnit}（${pct}%）`);
    }
  }
  return lines.join('\n');
}
