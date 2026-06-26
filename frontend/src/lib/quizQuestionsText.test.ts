import test from 'node:test';
import assert from 'node:assert/strict';
import { formatQuizQuestionsText } from './quizQuestionsText';

const LABELS = { explanationLabel: 'Explanation: ' };

test('formatQuizQuestionsText returns empty string for no questions', () => {
  assert.equal(formatQuizQuestionsText([], LABELS), '');
});

test('formatQuizQuestionsText marks the correct option and omits explanation when empty', () => {
  const text = formatQuizQuestionsText(
    [
      {
        question: 'Capital of France?',
        options: [{ text: 'Paris' }, { text: 'Rome' }],
        answer_indices: [0],
        explanation: '',
      },
    ],
    LABELS,
  );
  assert.equal(text, '1. Capital of France?\n  A. Paris ✓\n  B. Rome');
});

test('formatQuizQuestionsText marks multiple correct options and appends explanation', () => {
  const text = formatQuizQuestionsText(
    [
      {
        question: 'Even numbers?',
        options: [{ text: '1' }, { text: '2' }, { text: '4' }],
        answer_indices: [1, 2],
        explanation: '2 and 4 are even',
      },
    ],
    LABELS,
  );
  assert.equal(text, '1. Even numbers?\n  A. 1\n  B. 2 ✓\n  C. 4 ✓\n   Explanation: 2 and 4 are even');
});

test('formatQuizQuestionsText numbers questions and separates them with a blank line', () => {
  const text = formatQuizQuestionsText(
    [
      { question: 'Q1', options: [{ text: 'a' }], answer_indices: [0] },
      { question: 'Q2', options: [{ text: 'b' }], answer_indices: [] },
    ],
    LABELS,
  );
  assert.equal(text, '1. Q1\n  A. a ✓\n\n2. Q2\n  A. b');
});
