import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hasMarkdownOrMath } from './quizMarkdown';

test('hasMarkdownOrMath spots math and Markdown, not plain sentences', () => {
  assert.equal(hasMarkdownOrMath('求 $\\det(A)$ 的值'), true);
  assert.equal(hasMarkdownOrMath('$$\\int_0^1 x\\,dx$$'), true);
  assert.equal(hasMarkdownOrMath('\\(a^2+b^2\\) 等於多少？'), true);
  assert.equal(hasMarkdownOrMath('**重點**：矩陣'), true);
  assert.equal(hasMarkdownOrMath('- 甲\n- 乙'), true);
  assert.equal(hasMarkdownOrMath('| a | b |'), true);
  assert.equal(hasMarkdownOrMath('下列何者為線性映射？'), false);
  assert.equal(hasMarkdownOrMath('花了 $5 買東西'), false, 'a lone dollar sign is not a formula');
  assert.equal(hasMarkdownOrMath(''), false);
});

// 測驗題目允許 Markdown 以方便顯示公式（使用者要求，2026-09-15）：作答、結果、紀錄、預覽都要
// 走同一個渲染器，編輯器要有提示與預覽。沒有渲染測試環境，以原始碼層級釘住接線。
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('quiz question, option and explanation text render through MarkdownMath everywhere they are shown', () => {
  const page = read('../pages/QuizBuilderPage.tsx');
  assert.match(page, /import \{ MarkdownMath \} from '\.\.\/components\/MarkdownMath'/);
  const questionUses = page.match(/<MarkdownMath content=\{q\.question\}/g) ?? [];
  assert.ok(questionUses.length >= 5, `taking view, wrong-answer review, attempt detail, quiz preview and editor preview (got ${questionUses.length})`);
  assert.match(page, /<MarkdownMath content=\{option\.text\}/, 'options while taking the quiz');
  assert.ok((page.match(/<MarkdownMath content=\{opt\.text\}/g) ?? []).length >= 2, 'options in the attempt detail and the preview');
  assert.ok((page.match(/<MarkdownMath content=\{q\.explanation/g) ?? []).length >= 3, 'explanations in all three places');
  // The heading no longer embeds the question into a translated string (that would flatten the markup).
  assert.doesNotMatch(page, /quiz\.questionScoreHeading', \{[^}]*question: q\.question/);
  assert.match(page, /hasMarkdownOrMath\(q\.question\)/, 'the editor previews only when there is something to render');
  assert.match(page, /t\('quiz\.markdownHint'\)/);
  for (const file of ['./play/PostClassReportPanel.tsx', './play/TutorQuizDialog.tsx'].map((f) => `../pages/${f.slice(2)}`)) {
    assert.match(read(file), /<MarkdownMath content=\{/, `${file} renders questions the same way`);
  }
});
