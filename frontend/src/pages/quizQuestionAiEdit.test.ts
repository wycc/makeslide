import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../locales/zh-TW';
import { en } from '../locales/en';

// 編輯模式每題的 AI 修改（使用者要求，2026-11-01）。原始碼層級守門。
const SRC = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'QuizBuilderPage.tsx'), 'utf8');

test('every question card in the editor has its own AI button', () => {
  const editorCard = SRC.slice(SRC.indexOf('key={q.id}\n', SRC.indexOf('draggingQIdx')));
  assert.match(editorCard, /onClick=\{\(\) => openAiEdit\(aiEditQuestionId === q\.id \? null : q\.id\)\}/);
  assert.match(editorCard, /\{aiEditQuestionId === q\.id \? \(/, 'the prompt box opens under that question only');
});

test('the result lands on the right question of the right quiz, and can be undone', () => {
  const handler = /const handleAiEditQuestion = async \(\) => \{([\s\S]*?)\n  \};/.exec(SRC)?.[1] ?? '';
  // By id rather than index: the teacher may reorder or delete questions while the model works.
  assert.match(handler, /setQuestions\(\(prev\) => prev\.map\(\(q\) => \(q\.id === target\.id \? edited : q\)\)\);/);
  // Every quiz numbers its questions q1, q2…, so a late answer must not land in another quiz.
  assert.ok(handler.indexOf('aiEditQuizRef.current !== startedInQuiz') < handler.indexOf('setQuestions'));
  assert.match(handler, /setAiEditUndo\(target\);/);
  assert.match(SRC, /disabled=\{busy \|\| aiEditBusy \|\| !canSave\}/, 'saving would switch the quiz id mid-edit');
  for (const locale of [zhTW, en]) {
    for (const key of ['quiz.aiEdit', 'quiz.aiEditPlaceholder', 'quiz.aiEditRun', 'quiz.aiEditRunning', 'quiz.aiEditDone', 'quiz.aiEditUndo', 'quiz.aiEditFailed'] as const) {
      assert.ok(locale[key], key);
    }
  }
});

test('a long option wraps in the editor instead of scrolling inside a one-line input', () => {
  assert.doesNotMatch(SRC, /<input value=\{option\.text\}/);
  assert.match(SRC, /<AutoGrowTextarea\s+value=\{option\.text\}[\s\S]{0,260}e\.key === 'Enter'[\s\S]{0,60}minRows=\{1\}/);
});
