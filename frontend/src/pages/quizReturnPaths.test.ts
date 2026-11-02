import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../locales/zh-TW';
import { en } from '../locales/en';

/**
 * 「離開後回不到測驗中」的前端收尾（使用者回報，2026-11-02）：答案要能接回來、空白卷不要留紀錄、
 * 播放頁要有回到測驗的入口。沒有渲染測試環境，以原始碼層級釘住接線。
 */
const DIR = path.dirname(new URL(import.meta.url).pathname);
const PAGE = fs.readFileSync(path.join(DIR, 'QuizBuilderPage.tsx'), 'utf8');
const PLAY = fs.readFileSync(path.join(DIR, 'PlayPage.tsx'), 'utf8');

test('answers are restored from, and written to, the local draft', () => {
  assert.match(PAGE, /const answerDraftKey = activeQuiz && syncQuizSessionId \? `\$\{activeQuiz\.id\}:\$\{syncQuizSessionId\}` : null;/, 'same key shape as the proctor flags');
  assert.match(PAGE, /setStudentAnswers\(\(prev\) => \(Object\.keys\(prev\)\.length === 0 \? draft : prev\)\)/, 'a restore must not clobber answers this page already has');
  assert.match(PAGE, /writeQuizAnswerDraft\(answerDraftKey, studentAnswers\)/);
  assert.match(PAGE, /clearQuizAnswerDraft\(`\$\{activeQuiz\.id\}:\$\{syncQuizSessionId \?\? ''\}`\)/, 'finishing clears the draft');
  assert.match(PAGE, /setStudentAnswers\(\{\}\);\s*\n\s*if \(answerDraftKey\) clearQuizAnswerDraft\(answerDraftKey\);/, "the teacher's answer reset clears it too, or the draft would come straight back");
});

test('a blank sheet is never recorded as an attempt', () => {
  const submit = /const submitFollowerAttempt = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(PAGE)?.[1] ?? '';
  assert.match(submit, /if \(isBlankAnswerSheet\(snapshot\.answers\)\) return;/);
  assert.ok(submit.indexOf('isBlankAnswerSheet') < submit.indexOf('submitQuizAttempt'), 'checked before the request is built');
});

test('the play page offers a way back into a running quiz', () => {
  assert.match(PLAY, /setSyncQuizInProgress\(\s*state\.role !== 'master'\s*&& Boolean\(state\.quiz_mode\)/, 'tracked on every poll, regardless of fullscreen');
  assert.match(PLAY, /\{syncQuizInProgress && pdfId \? \(/);
  assert.match(PLAY, /navigate\(`\/play\/\$\{encodeURIComponent\(pdfId\)\}\/quizzes`\)\}/);
  assert.match(PLAY, /play\.returnToQuiz/);
  for (const locale of [zhTW, en]) {
    assert.equal(typeof locale['play.returnToQuiz'], 'string');
    assert.ok(locale['play.returnToQuiz'].length > 0);
  }
});
