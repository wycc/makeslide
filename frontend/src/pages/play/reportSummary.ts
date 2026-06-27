import type {
  PdfReportPollPageSummary,
  PdfReportQuizQuestionSummary,
  PdfReportSummary,
  PdfReportWatchProgressPageSummary,
} from '../../lib/api';
import { clamp } from '../../lib/clamp';

export function formatReportPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

export function formatReportNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return String(Math.round(value * 10) / 10);
}

export function getHardestQuestions(summary: PdfReportSummary | null): PdfReportQuizQuestionSummary[] {
  const questions = summary?.quiz.hardest_questions;
  if (!Array.isArray(questions)) return [];
  return [...questions]
    .filter((item) => item.attempt_count > 0)
    .sort((a, b) => b.wrong_rate - a.wrong_rate || b.wrong_count - a.wrong_count || a.question_id.localeCompare(b.question_id))
    .slice(0, 3);
}

export function getMostDivergentPollPages(summary: PdfReportSummary | null): PdfReportPollPageSummary[] {
  const pages = summary?.polls.most_divergent_pages;
  if (!Array.isArray(pages)) return [];
  return [...pages]
    .filter((item) => item.total_votes > 0)
    .sort((a, b) => b.divergence_score - a.divergence_score || b.total_votes - a.total_votes || a.page_number - b.page_number)
    .slice(0, 3);
}

export function getLowestCompletionPages(summary: PdfReportSummary | null): PdfReportWatchProgressPageSummary[] {
  const explicit = summary?.watch_progress.lowest_completion_pages;
  const pages = Array.isArray(explicit) ? explicit : summary?.watch_progress.pages;
  if (!Array.isArray(pages)) return [];
  return [...pages]
    .filter((item) => item.total_viewers > 0)
    .sort((a, b) => a.completion_rate - b.completion_rate || a.completed_viewers - b.completed_viewers || a.page_number - b.page_number)
    .slice(0, 3);
}

/** formatReportSummaryMarkdown 所需的可翻譯字串；由元件以 i18n 注入，使本函式維持純粹可測。 */
export interface ReportMarkdownLabels {
  heading: string;
  participants: string;
  quizAverage: string;
  pollParticipation: string;
  hardestQuestions: string;
  divergentPolls: string;
  lowestCompletion: string;
  page: string;
  none: string;
}

/**
 * 將課後報告摘要輸出為 Markdown（整體數字 + 最難測驗題 / 最分歧投票頁 / 最低完成率頁三榜單）。
 * 純函式：所有顯示文字由 labels 注入，數值沿用 formatReportPercent/formatReportNumber。
 * summary 為 null 時回傳空字串（呼叫端於無資料時應停用複製）。
 */
export function formatReportSummaryMarkdown(
  summary: PdfReportSummary | null,
  labels: ReportMarkdownLabels,
  pdfTitle?: string | null,
): string {
  if (!summary) return '';
  const lines: string[] = [];
  lines.push(`# ${labels.heading}${pdfTitle ? `：${pdfTitle}` : ''}`);
  lines.push('');
  lines.push(`- ${labels.participants}: ${formatReportNumber(summary.participant_count)}`);
  lines.push(`- ${labels.quizAverage}: ${summary.quiz.average_score == null ? '—' : formatReportNumber(summary.quiz.average_score)}`);
  lines.push(`- ${labels.pollParticipation}: ${formatReportPercent(summary.polls.participation_rate)}`);

  const hardest = getHardestQuestions(summary);
  lines.push('', `## ${labels.hardestQuestions}`);
  if (hardest.length === 0) {
    lines.push(labels.none);
  } else {
    hardest.forEach((q, i) => {
      lines.push(`${i + 1}. ${q.question ?? q.question_id} — ${formatReportPercent(q.wrong_rate)} (${q.wrong_count}/${q.attempt_count})`);
    });
  }

  const divergent = getMostDivergentPollPages(summary);
  lines.push('', `## ${labels.divergentPolls}`);
  if (divergent.length === 0) {
    lines.push(labels.none);
  } else {
    divergent.forEach((p, i) => {
      lines.push(`${i + 1}. ${labels.page} ${p.page_number}${p.question ? ` — ${p.question}` : ''} (${formatReportNumber(p.total_votes)})`);
    });
  }

  const lowest = getLowestCompletionPages(summary);
  lines.push('', `## ${labels.lowestCompletion}`);
  if (lowest.length === 0) {
    lines.push(labels.none);
  } else {
    lowest.forEach((p, i) => {
      lines.push(`${i + 1}. ${labels.page} ${p.page_number} — ${formatReportPercent(p.completion_rate)} (${p.completed_viewers}/${p.total_viewers})`);
    });
  }

  return lines.join('\n');
}

