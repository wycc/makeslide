import test from 'node:test';
import assert from 'node:assert/strict';
import type { PdfReportSummary } from '../../lib/api';
import {
  formatReportPercent,
  formatReportSummaryMarkdown,
  getHardestQuestions,
  getLowestCompletionPages,
  getMostDivergentPollPages,
  type ReportMarkdownLabels,
} from './reportSummary';

const LABELS: ReportMarkdownLabels = {
  heading: 'Report',
  participants: 'Participants',
  quizAverage: 'Quiz avg',
  pollParticipation: 'Poll rate',
  hardestQuestions: 'Hardest',
  divergentPolls: 'Divergent',
  lowestCompletion: 'Lowest completion',
  page: 'Page',
  none: '(none)',
};

const baseSummary: PdfReportSummary = {
  pdf_id: 'pdf-1',
  participant_count: 3,
  quiz: { attempt_count: 0, participant_count: 0, average_score: null },
  polls: { poll_count: 0, vote_count: 0, participant_count: 0, participation_rate: 0 },
  questions: { count: 0, participant_count: 0 },
  watch_progress: { pages: [] },
  generated_at: '2026-06-22T00:00:00.000Z',
};

test('getLowestCompletionPages ranks watched pages by completion rate and skips empty pages', () => {
  const result = getLowestCompletionPages({
    ...baseSummary,
    watch_progress: {
      pages: [
        { page_number: 1, total_viewers: 4, completed_viewers: 4, completion_rate: 1, avg_listened_ratio: 0.95 },
        { page_number: 2, total_viewers: 0, completed_viewers: 0, completion_rate: 0, avg_listened_ratio: null },
        { page_number: 3, total_viewers: 4, completed_viewers: 1, completion_rate: 0.25, avg_listened_ratio: 0.4 },
        { page_number: 4, total_viewers: 4, completed_viewers: 2, completion_rate: 0.5, avg_listened_ratio: 0.6 },
      ],
    },
  });
  assert.deepEqual(result.map((item) => item.page_number), [3, 4, 1]);
});

test('getHardestQuestions uses optional future detail fields when present', () => {
  const result = getHardestQuestions({
    ...baseSummary,
    quiz: {
      attempt_count: 5,
      participant_count: 3,
      average_score: 70,
      hardest_questions: [
        { question_id: 'a', question: 'A', attempt_count: 2, wrong_count: 1, wrong_rate: 0.5 },
        { question_id: 'b', question: 'B', attempt_count: 3, wrong_count: 3, wrong_rate: 1 },
        { question_id: 'empty', attempt_count: 0, wrong_count: 0, wrong_rate: 1 },
      ],
    },
  });
  assert.deepEqual(result.map((item) => item.question_id), ['b', 'a']);
});

test('getMostDivergentPollPages uses optional future poll detail fields when present', () => {
  const result = getMostDivergentPollPages({
    ...baseSummary,
    polls: {
      poll_count: 2,
      vote_count: 10,
      participant_count: 5,
      participation_rate: 1,
      most_divergent_pages: [
        { page_number: 1, total_votes: 5, divergence_score: 0.2 },
        { page_number: 2, total_votes: 5, divergence_score: 0.8 },
        { page_number: 3, total_votes: 0, divergence_score: 1 },
      ],
    },
  });
  assert.deepEqual(result.map((item) => item.page_number), [2, 1]);
});

test('formatReportPercent clamps finite ratios and hides missing values', () => {
  assert.equal(formatReportPercent(0.426), '43%');
  assert.equal(formatReportPercent(1.2), '100%');
  assert.equal(formatReportPercent(null), '—');
});

test('formatReportSummaryMarkdown returns empty string for a null summary', () => {
  assert.equal(formatReportSummaryMarkdown(null, LABELS), '');
});

test('formatReportSummaryMarkdown renders overall numbers and shows (none) for empty rankings', () => {
  const md = formatReportSummaryMarkdown(baseSummary, LABELS, 'My Deck');
  assert.match(md, /^# Report：My Deck/);
  assert.match(md, /- Participants: 3/);
  assert.match(md, /- Quiz avg: —/); // average_score is null
  assert.match(md, /- Poll rate: 0%/);
  // all three rankings are empty in baseSummary -> each section shows the none label
  assert.equal((md.match(/\(none\)/g) ?? []).length, 3);
});

test('formatReportSummaryMarkdown lists ranked questions, poll pages and completion pages', () => {
  const summary: PdfReportSummary = {
    ...baseSummary,
    quiz: {
      attempt_count: 5,
      participant_count: 3,
      average_score: 72,
      hardest_questions: [
        { question_id: 'a', question: 'What is X?', attempt_count: 4, wrong_count: 3, wrong_rate: 0.75 },
      ],
    },
    polls: {
      poll_count: 1,
      vote_count: 5,
      participant_count: 5,
      participation_rate: 0.5,
      most_divergent_pages: [{ page_number: 2, question: 'Agree?', total_votes: 5, divergence_score: 0.9 }],
    },
    watch_progress: {
      pages: [{ page_number: 4, total_viewers: 4, completed_viewers: 1, completion_rate: 0.25, avg_listened_ratio: 0.4 }],
    },
  };
  const md = formatReportSummaryMarkdown(summary, LABELS);
  assert.match(md, /## Hardest\n1\. What is X\? — 75% \(3\/4\)/);
  assert.match(md, /## Divergent\n1\. Page 2 — Agree\? \(5\)/);
  assert.match(md, /## Lowest completion\n1\. Page 4 — 25% \(1\/4\)/);
  assert.doesNotMatch(md, /\(none\)/);
});

