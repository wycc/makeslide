import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../locales/zh-TW';
import { en } from '../locales/en';

/**
 * 防弊開關與離開紀錄（使用者要求，2026-09-22）：測驗設定可關閉防弊；學生的每次離開連同進度
 * 回報給老師，「測驗中的學員」列出離開次數與時間。問答題只能用相機拍，不能選檔上傳。
 * 沒有渲染測試環境，以原始碼層級釘住接線。
 */
const DIR = path.dirname(new URL(import.meta.url).pathname);
const PAGE = fs.readFileSync(path.join(DIR, 'QuizBuilderPage.tsx'), 'utf8');
const UPLOADER = fs.readFileSync(path.join(DIR, '../components/EssayAnswerUploader.tsx'), 'utf8');

test('the quiz form saves the strict-proctor switch and the gate gets it', () => {
  assert.match(PAGE, /record_camera: recordCamera, strict_proctor: strictProctor \}/, 'saved with the quiz');
  assert.match(PAGE, /setStrictProctor\(quiz\.strict_proctor \?\? true\)/, 'loading a quiz restores it, defaulting to strict');
  assert.match(PAGE, /checked=\{strictProctor\}/, 'the form has a checkbox for it');
  assert.match(PAGE, /strict=\{activeQuiz\.strict_proctor !== false\}/, 'older quizzes without the field stay strict');
  assert.match(PAGE, /onLeavesChange=\{handleQuizLeavesChange\}/);
});

test('leaves are reported with progress and listed per student for the owner', () => {
  const handler = /const handleQuizLeavesChange = useCallback\(\(leaves: SyncQuizLeave\[\]\) => \{([\s\S]*?)\n  \}, \[/.exec(PAGE)?.[1] ?? '';
  assert.match(handler, /isQuizSessionEnded\(/, 'an ended attempt does not report (it would flip the teacher view back to in-progress)');
  assert.match(handler, /reportOwnProgress\(pdfId, clientId, \{[\s\S]*?leaves,/);
  assert.match(PAGE, /p\.leaves && p\.leaves\.length > 0/, 'the student row shows leaves only when there are any');
  assert.match(PAGE, /formatMessage\('quiz\.leaveCountBadge', \{ count: p\.leaves\.length \}\)/);
  assert.match(PAGE, /formatLeaveClock\(leave\.left_at\)/, 'each leave shows when it happened');
  assert.match(PAGE, /leave\.away_ms === null\s*\? t\('quiz\.leaveStillAway'\)/, 'and how long, or that the student is still away');
  for (const locale of [zhTW, en]) {
    assert.match(locale['quiz.leaveCountBadge'], /\{count\}/);
    assert.match(locale['quiz.leaveAwaySeconds'], /\{seconds\}/);
    assert.equal(typeof locale['quiz.strictProctor'], 'string');
    assert.equal(typeof locale['quiz.strictProctorHint'], 'string');
  }
});

test('essay answers can only come from the in-app camera, not a file picker', () => {
  // 2026-11-03：App 內相機打不開時才退回原生相機輸入（capture="environment" 直接開相機 App，不是相簿）。
  const fileInputs = UPLOADER.match(/<input[^>]*type="file"[^>]*>/g) ?? [];
  assert.equal(fileInputs.length, 1, 'exactly one file input, the native-camera fallback');
  assert.match(fileInputs[0]!, /capture="environment"/, 'it opens the camera, never the gallery');
  assert.ok(UPLOADER.indexOf('{cameraError ? (') < UPLOADER.indexOf('type="file"'), 'and only inside the camera-error branch');
  assert.doesNotMatch(UPLOADER, /quiz\.essay\.pickFile/);
  assert.match(UPLOADER, /getUserMedia/, 'the live camera stays');
  for (const locale of [zhTW, en] as Array<Record<string, string>>) {
    assert.equal(locale['quiz.essay.pickFile'], undefined, 'the dead label is gone');
  }
});
