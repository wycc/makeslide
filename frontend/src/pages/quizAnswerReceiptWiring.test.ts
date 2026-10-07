import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../locales/zh-TW';
import { en } from '../locales/en';

/**
 * 交卷後自動下載作答證明 PDF、交卷前提醒未作答題目（使用者要求，2026-10-07）。以原始碼層級釘住接線。
 */
const dir = path.dirname(new URL(import.meta.url).pathname);
const SRC = fs.readFileSync(path.join(dir, 'QuizBuilderPage.tsx'), 'utf8');
const GATE = fs.readFileSync(path.join(dir, '..', 'components', 'QuizProctorGate.tsx'), 'utf8');
const ESSAY = fs.readFileSync(path.join(dir, '..', 'components', 'EssayAnswerUploader.tsx'), 'utf8');

test('every attempt submission ends in a receipt: confirmed on success, unconfirmed after the final failure', () => {
  const fn = /const submitFollowerAttempt = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(SRC)?.[1] ?? '';
  assert.match(fn, /downloadAnswerReceipt\(snapshot, quiz, clientId, saved\)/);
  assert.match(fn, /downloadAnswerReceipt\(snapshot, quiz, clientId, null\)/);
  assert.match(SRC, /triggerDownload\(url, filename\)/, 'download starts automatically');
});

test('the finish dialog lists unanswered questions (choices and essays) before submitting', () => {
  assert.match(SRC, /findUnansweredQuestionNumbers\(quiz\.questions, studentAnswers, essayPhotoCounts\)/);
  assert.match(SRC, /'quiz\.finishQuizUnansweredBody'/);
  assert.match(SRC, /onUploaded=\{\(count\) => handleEssayUploaded\(q\.id, count\)\}/);
  assert.match(ESSAY, /setStatus\('done'\);\s*onUploaded\?\.\(photos\.length\);/);
});

test('ended screens offer re-downloading the receipt', () => {
  assert.match(SRC, /endedExtra=\{renderAnswerReceiptStatus\(\)\}/);
  assert.equal((GATE.match(/\{endedExtra\}/g) ?? []).length, 2, 'completed and locked screens');
});

test('new strings exist in both locales with their placeholders', () => {
  for (const locale of [zhTW, en] as Record<string, string>[]) {
    assert.match(locale['quiz.finishQuizUnansweredBody'] ?? '', /\{list\}.*\{count\}|\{count\}.*\{list\}/s);
    assert.match(locale['quiz.receipt.downloaded'] ?? '', /\{file\}/);
    assert.match(locale['quiz.receipt.page'] ?? '', /\{page\}.*\{total\}/);
  }
});
