import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allQuestionsComplete } from './quizValidation';

const opt = (text: string) => ({ text });

test('accepts a choice question with a non-empty stem and >= 2 non-empty options', () => {
  assert.equal(allQuestionsComplete([{ question: 'Q', type: 'single', options: [opt('a'), opt('b')] }]), true);
});

test('rejects a question with a blank stem', () => {
  assert.equal(allQuestionsComplete([{ question: '   ', type: 'single', options: [opt('a'), opt('b')] }]), false);
});

test('rejects a choice question with fewer than 2 non-empty options', () => {
  assert.equal(allQuestionsComplete([{ question: 'Q', type: 'multiple', options: [opt('a'), opt('  ')] }]), false);
});

test('accepts an essay question regardless of options', () => {
  assert.equal(allQuestionsComplete([{ question: 'Explain', type: 'essay', options: [] }]), true);
});

test('requires every question to be complete', () => {
  const questions = [
    { question: 'Q1', type: 'single', options: [opt('a'), opt('b')] },
    { question: '', type: 'single', options: [opt('a'), opt('b')] },
  ];
  assert.equal(allQuestionsComplete(questions), false);
});

test('returns true for an empty list (caller checks non-empty separately)', () => {
  assert.equal(allQuestionsComplete([]), true);
});
