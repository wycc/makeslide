import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 使用者回報（2026-10-20）：防弊關掉後學生「出去後進不來」。四項修正的接線守門（無渲染環境，原始碼層級）：
 * (1) 重進許可以代碼比對；(2) 已結束畫面仍回報進度（submitted:true），新 client 才會出現在老師名單；
 * (3) 作答暫存並還原；(4) 回到簡報頁時仍自動全螢幕、導回測驗。
 */
const DIR = path.dirname(new URL(import.meta.url).pathname);
const PAGE = fs.readFileSync(path.join(DIR, 'QuizBuilderPage.tsx'), 'utf8');
const PLAY = fs.readFileSync(path.join(DIR, 'PlayPage.tsx'), 'utf8');
const SYNC = fs.readFileSync(path.join(DIR, '../../../backend/src/routes/pdfs/sync.ts'), 'utf8');

test('reentry is granted by student code as well as client id, and the student poll carries the code', () => {
  assert.match(SYNC, /quizReentryAllowedCodes: Set<string>;/);
  assert.match(SYNC, /quiz_allow_reentry: clientId \? isReentryAllowedFor\(session, clientId\) : false/);
  assert.match(SYNC, /if \(code\) session\.quizReentryAllowedCodes\.add\(code\);/, 'granting names the code too');
  assert.match(SYNC, /adoptProgressFromSameCode\(session, clientId, code, quizId\)/, 'the old row for the same code is folded into the new one');
  assert.match(SYNC, /user_code: z\.string\(\)\.trim\(\)\.max\(128\)\.optional\(\),\n  \}\);/, 'GET state accepts the code');
  assert.match(PAGE, /fetchPlaybackSyncState\(pdfId, clientId, userCode\)/, 'the quiz page poll sends it');
});

test('an ended attempt still reports once, as submitted, so a new client shows up for the teacher', () => {
  const effect = /const ended = isQuizSessionEnded\(`\$\{activeQuiz\.id\}:\$\{syncQuizSessionId \?\? ''\}`\);([\s\S]*?)\}, \[pdfId, isFollowerTesting, activeQuiz, studentAnswers, syncQuizSessionId\]\);/.exec(PAGE)?.[1] ?? '';
  assert.ok(effect.length > 0, 'the progress effect computes ended instead of returning early');
  assert.match(effect, /const submitted = ended \|\| \(totalQuestions > 0 && answeredCount >= totalQuestions\);/);
  assert.doesNotMatch(effect, /if \(ended\) return;/);
});

test('answers are restored from local storage before they are saved, and cleared when the quiz ends', () => {
  assert.match(PAGE, /const stored = readStoredQuizAnswers\(studentAnswersKey\);\s*if \(stored && Object\.keys\(stored\)\.length > 0\) setStudentAnswers\(stored\);/);
  assert.match(PAGE, /if \(!studentAnswersKey \|\| restoredAnswersKeyRef\.current !== studentAnswersKey\) return;\s*writeStoredQuizAnswers\(studentAnswersKey, studentAnswers\);/, 'never writes before restoring');
  assert.match(PAGE, /clearStoredQuizAnswers\(restoredAnswersKeyRef\.current\);\s*navigate\(`\/play\/\$\{encodeURIComponent\(pdfId\)\}\?fullscreen=1`\)/);
});

test('the play page remembers follower fullscreen and the share token for this tab', () => {
  assert.match(PLAY, /const currentShareToken = urlShareToken \|\| readShareToken\(pdfId \?\? ''\);/);
  assert.match(PLAY, /searchParams\.get\('fullscreen'\) === '1' \|\| readFollowerFullscreen\(pdfId \?\? ''\)/);
  assert.match(PLAY, /markFollowerFullscreen\(pdfId\);\s*navigate\(`\/play\/\$\{encodeURIComponent\(pdfId\)\}\/quizzes`, \{ replace: true \}\);/, 'set right before sending the student into the quiz');
  assert.equal((PLAY.match(/clearFollowerFullscreen\(pdfId\)/g) ?? []).length, 2, 'cleared on both explicit exits from fullscreen');
});
