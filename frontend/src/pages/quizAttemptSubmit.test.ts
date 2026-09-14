import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../locales/zh-TW';
import { en } from '../locales/en';

/**
 * 學生沒有設定學號時交卷送出 `code: null`，後端的 `z.string().optional()` 回 400，前端又靜默吞掉——
 * `PnefnAntiK` 小考一整份作答就這樣消失（使用者回報，2026-09-15）。後端改收 nullish（後端測試釘住），
 * 前端則：沒有學號就不送這個欄位、失敗要提示學生並重試。以原始碼層級釘住。
 */
const SRC = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'QuizBuilderPage.tsx'), 'utf8');

test('submitting an attempt never sends code: null, and a failure is retried then shown, not swallowed', () => {
  const fn = /const submitFollowerAttempt = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(SRC)?.[1] ?? '';
  assert.ok(fn, 'submitFollowerAttempt exists');
  assert.match(fn, /code: snapshot\.code \?\? undefined/, 'no code → field omitted from the JSON');
  assert.match(fn, /attempt\(remaining - 1\)/, 'retries');
  assert.match(fn, /submittedAttemptRef\.current = null;/, 'after the retries the next trigger may send again');
  assert.match(fn, /setMessage\(interpolateTemplate\(t\('quiz\.attemptSubmitFailed'\)/, 'the student is told');
  assert.doesNotMatch(fn, /\.catch\(\(\) => \{\s*submittedAttemptRef\.current = null;\s*\}\)/, 'the silent catch is gone');
  for (const locale of [zhTW, en]) assert.match(locale['quiz.attemptSubmitFailed'], /\{detail\}/);
});
