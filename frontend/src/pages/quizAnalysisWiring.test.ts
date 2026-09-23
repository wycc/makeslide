import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../locales/zh-TW';
import { en } from '../locales/en';

/**
 * 小考分析的接線（使用者要求，2026-09-23）：統計疊在既有的「答案與解析」上（沿用原有顯示），
 * 解析要完整顯示不被截斷，並有逐題全螢幕講評。沒有渲染測試環境，以原始碼層級釘住。
 */
const DIR = path.dirname(new URL(import.meta.url).pathname);
const PAGE = fs.readFileSync(path.join(DIR, 'QuizBuilderPage.tsx'), 'utf8');
const FULLSCREEN = fs.readFileSync(path.join(DIR, '../components/QuizReviewFullscreen.tsx'), 'utf8');

test('analysis loads only with the answers view open, defaults to the latest session and can switch', () => {
  assert.match(PAGE, /if \(!showEditorAnswers \|\| !pdfId \|\| selectedQuizId == null\)/, 'editing questions does not fetch attempts');
  assert.match(PAGE, /setAnalysisSessionId\(resp\.sessions\[0\]\?\.session_id \?\? null\)/, 'newest session first (the API sorts them)');
  assert.match(PAGE, /onChange=\{\(e\) => setAnalysisSessionId\(e\.target\.value \|\| null\)\}/);
  assert.match(PAGE, /<option value="">\{t\('quiz\.analysis\.allSessions'\)\}<\/option>/, 'the empty value is the all-sessions total');
  assert.match(PAGE, /attemptsForAnalysis\(analysisSessions, analysisSessionId\)/);
});

test('each option carries its pick count, and every question its correct rate', () => {
  assert.match(PAGE, /const optionStat = showEditorAnswers && hasAnalysis \? analysisStats\[qIdx\]\?\.options\[oIdx\] \?\? null : null;/);
  assert.match(PAGE, /formatMessage\(isAnswer \? 'quiz\.analysis\.optionPicked' : 'quiz\.analysis\.optionWrongPicked', \{ count: optionStat\.count \}\)/);
  assert.match(PAGE, /formatMessage\('quiz\.analysis\.correctRate', \{ correct: stat\.correct, answered: stat\.answered, percent \}\)/);
  assert.match(PAGE, /quiz\.analysis\.wrongCount/);
  assert.match(PAGE, /quiz\.analysis\.unanswered/);
});

test('the explanation is shown in full instead of a two-row box', () => {
  assert.match(PAGE, /<AutoGrowTextarea value=\{q\.explanation\}/, 'the editor box grows with the text');
  assert.doesNotMatch(PAGE, /value=\{q\.explanation\}[^>]*rows=\{2\}/, 'no fixed two-row explanation left');
  const grow = fs.readFileSync(path.join(DIR, '../components/AutoGrowTextarea.tsx'), 'utf8');
  assert.match(grow, /el\.style\.height = 'auto';/, 'reset before measuring, or shrinking never shrinks');
  assert.match(grow, /el\.scrollHeight/);
});

test('fullscreen review walks question by question with answer, counts and full explanation', () => {
  assert.match(PAGE, /<QuizReviewFullscreen[\s\S]*?stats=\{hasAnalysis \? analysisStats : null\}/, 'without attempts it still reviews the questions');
  assert.match(FULLSCREEN, /requestFullscreen\?\.\(\)/);
  assert.match(FULLSCREEN, /if \(!document\.fullscreenElement\) onCloseRef\.current\(\);/, 'leaving fullscreen closes the overlay');
  assert.match(FULLSCREEN, /e\.key === 'ArrowRight' \|\| e\.key === 'PageDown'/, 'keyboard paging for projection');
  assert.match(FULLSCREEN, /question\.explanation \|\| t\('quiz\.noExplanation'\)/);
  assert.match(FULLSCREEN, /quiz\.analysis\.optionWrongPicked/, 'wrong options show how many picked them');
  for (const locale of [zhTW, en]) {
    assert.match(locale['quiz.analysis.correctRate'], /\{correct\}/);
    assert.match(locale['quiz.analysis.correctRate'], /\{percent\}/);
    assert.match(locale['quiz.analysis.optionWrongPicked'], /\{count\}/);
    assert.match(locale['quiz.analysis.progress'], /\{index\}/);
    assert.equal(typeof locale['quiz.analysis.fullscreen'], 'string');
  }
});

// 使用者要求（2026-09-23）：全螢幕時點選項要顯示答錯的人的代碼。
test('fullscreen review lists who picked an option when it is clicked, and folds it on paging', () => {
  assert.match(FULLSCREEN, /onClick=\{optionStat \? \(\) => toggleOption\(oIdx\) : undefined\}/, 'only clickable when there are attempts');
  assert.match(FULLSCREEN, /optionStat\.pickers\.map\(/);
  assert.match(FULLSCREEN, /p\.label \?\? t\('quiz\.analysis\.pickerAnonymous'\)/);
  assert.match(FULLSCREEN, /setIndex\(\(prev\) => [^;]*;\s*setOpenOption\(null\);/, 'changing question closes the list');
  for (const locale of [zhTW, en]) {
    assert.match(locale['quiz.analysis.pickers'], /\{count\}/);
    assert.equal(typeof locale['quiz.analysis.noPickers'], 'string');
    assert.equal(typeof locale['quiz.analysis.pickerAnonymous'], 'string');
  }
});
