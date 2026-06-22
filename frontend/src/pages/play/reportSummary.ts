import type {
  PdfReportPollPageSummary,
  PdfReportQuizQuestionSummary,
  PdfReportSummary,
  PdfReportWatchProgressPageSummary,
} from '../../lib/api';

export function formatReportPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
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

