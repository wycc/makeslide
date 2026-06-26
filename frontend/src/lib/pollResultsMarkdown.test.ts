import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPollResultsMarkdown } from './pollResultsMarkdown';

const LABELS = { heading: 'Poll results', votesUnit: 'votes' };

test('formatPollResultsMarkdown returns empty string for no polls', () => {
  assert.equal(formatPollResultsMarkdown([], LABELS), '');
});

test('formatPollResultsMarkdown renders a poll with per-option votes and percentages', () => {
  const md = formatPollResultsMarkdown(
    [
      {
        question: 'Favourite?',
        total_votes: 4,
        options: [
          { text: 'A', votes: 3 },
          { text: 'B', votes: 1 },
        ],
      },
    ],
    LABELS,
  );
  assert.equal(md, '# Poll results\n\n## Favourite?\n- A：3 votes（75%）\n- B：1 votes（25%）');
});

test('formatPollResultsMarkdown shows 0% when there are no votes', () => {
  const md = formatPollResultsMarkdown(
    [{ question: 'Q', total_votes: 0, options: [{ text: 'X', votes: 0 }] }],
    LABELS,
  );
  assert.equal(md, '# Poll results\n\n## Q\n- X：0 votes（0%）');
});

test('formatPollResultsMarkdown renders multiple polls', () => {
  const md = formatPollResultsMarkdown(
    [
      { question: 'Q1', total_votes: 1, options: [{ text: 'a', votes: 1 }] },
      { question: 'Q2', total_votes: 2, options: [{ text: 'b', votes: 2 }] },
    ],
    LABELS,
  );
  assert.equal(md, '# Poll results\n\n## Q1\n- a：1 votes（100%）\n\n## Q2\n- b：2 votes（100%）');
});
