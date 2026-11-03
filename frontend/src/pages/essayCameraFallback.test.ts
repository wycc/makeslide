import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../locales/zh-TW';
import { en } from '../locales/en';

/**
 * 使用者回報（2026-11-03）：一堂課 6 位學生交了沒照片的問答題。App 內相機在 LINE 等內建瀏覽器
 * 打不開，而失敗訊息指向已移除的「選擇檔案」。修正：退回原生相機輸入、失敗原因回報老師、
 * 後端對測驗相關請求記錄 User-Agent。沒有渲染環境，以原始碼層級釘住接線。
 */
const DIR = path.dirname(new URL(import.meta.url).pathname);
const PAGE = fs.readFileSync(path.join(DIR, 'QuizBuilderPage.tsx'), 'utf8');
const UPLOADER = fs.readFileSync(path.join(DIR, '../components/EssayAnswerUploader.tsx'), 'utf8');
const SYNC = fs.readFileSync(path.join(DIR, '../../../backend/src/routes/pdfs/sync.ts'), 'utf8');

test('when the in-app camera fails the student gets a native camera input and the failure is reported', () => {
  assert.match(UPLOADER, /reportCameraError\('unsupported'\)/);
  assert.match(UPLOADER, /reportCameraError\('denied'\)/);
  assert.match(UPLOADER, /onCameraErrorRef\.current\?\.\(reason\)/, 'the page hears about it');
  assert.match(UPLOADER, /addFiles\(Array\.from\(e\.target\.files \?\? \[\]\)\);\s*e\.target\.value = '';/, 'each native shot is added and the input reset so the same file can be re-taken');
  for (const locale of [zhTW, en]) {
    assert.equal(typeof locale['quiz.essay.nativeCamera'], 'string');
    assert.doesNotMatch(locale['quiz.essay.cameraUnsupported'], /選擇檔案|Choose file/, 'no longer points at the removed file picker');
  }
});

test('the camera failure reaches the teacher through the progress report and shows on the student row', () => {
  assert.match(PAGE, /onCameraError=\{handleEssayCameraError\}/);
  assert.match(PAGE, /camera_error: reason,/, 'reported with the progress');
  assert.match(PAGE, /if \(cameraErrorReportedRef\.current\) \{\s*cameraErrorReportedRef\.current = false;\s*reportCameraErrorToTeacher\(null\);/, 'a successful upload clears it');
  assert.match(PAGE, /\{p\.camera_error \? \(/, 'the teacher list shows it');
  assert.match(SYNC, /camera_error: z\.enum\(\['unsupported', 'denied'\]\)\.nullable\(\)\.optional\(\)/);
  assert.match(SYNC, /cameraError: cameraError !== undefined \? cameraError : existing\?\.quizId === quizId \? existing\.cameraError : null/, 'a report without the field keeps the previous value');
  assert.match(SYNC, /camera_error: progress\.cameraError,/);
  for (const locale of [zhTW, en]) {
    assert.match(locale['quiz.cameraErrorBadge'], /\{reason\}/);
    assert.equal(typeof locale['quiz.cameraErrorUnsupported'], 'string');
    assert.equal(typeof locale['quiz.cameraErrorDenied'], 'string');
  }
});
