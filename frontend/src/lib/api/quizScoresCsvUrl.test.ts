import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { quizScoresCsvUrl } from './pdfs';

test('quizScoresCsvUrl points at the per-quiz score sheet with language and time zone', () => {
  assert.equal(
    quizScoresCsvUrl('abc_123', 7, 'zh-TW', 'Asia/Taipei'),
    'api/pdfs/abc_123/quizzes/7/scores.csv?lang=zh-TW&tz=Asia%2FTaipei',
  );
});

test('quizScoresCsvUrl leaves the time zone out when the browser has none', () => {
  assert.equal(quizScoresCsvUrl('abc_123', 7, 'en'), 'api/pdfs/abc_123/quizzes/7/scores.csv?lang=en');
});

test('the download button is wired into the history panel for teachers only', () => {
  // The sheet names every student, so the link must sit behind the same edit check as the rest of
  // the teacher controls — the backend refuses it too, but a dead link is still a confusing button.
  const page = readFileSync(new URL('../../pages/QuizBuilderPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /canEditQuiz && pdfId && historySessions\.length > 0 \? \(\s*<a\s+href=\{quizScoresCsvUrl\(/);
});
