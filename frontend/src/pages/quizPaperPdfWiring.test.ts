import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, 'QuizBuilderPage.tsx'), 'utf8');

test('試卷與解答按鈕都在 canEditQuiz 區塊內：學生看不到', () => {
  const start = page.indexOf('{canEditQuiz ? (\n                  <>');
  const end = page.indexOf('</>', start);
  assert.ok(start >= 0);
  const block = page.slice(start, end);
  assert.ok(block.includes("handleDownloadPaper(quiz.id, 'paper')"));
  assert.ok(block.includes("handleDownloadPaper(quiz.id, 'answers')"));
  assert.equal(page.split('handleDownloadPaper(quiz.id').length - 1, 2);
});

test('下載失敗會顯示訊息，不會靜靜沒反應', () => {
  assert.ok(page.includes("formatMessage('quiz.paper.failed'"));
  assert.ok(page.includes('{paperError ?'));
});
