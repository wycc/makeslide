import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../locales/zh-TW';
import { en } from '../locales/en';

/**
 * 測驗監考的離開倒數（使用者要求，2026-09-15）：偵測到離開但 10 秒內回來不算一次失敗，
 * 而且離開當下就要有畫面顯示倒數秒數與已記次數，而不是 10 秒後才突然跳警告。
 * 沒有渲染測試環境，以原始碼層級釘住接線；純邏輯在 lib/quizProctor.test.ts。
 */
const SRC = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'QuizProctorGate.tsx'), 'utf8');

test('leaving starts a visible countdown that a return within the grace window clears without counting', () => {
  const leave = /const handleLeave = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(SRC)?.[1] ?? '';
  assert.match(leave, /setAwaySeconds\(remainingGraceSeconds\(now, now\)\)/, 'the countdown shows the moment the student leaves');
  assert.match(leave, /setInterval\(/, 'and keeps ticking');
  assert.match(leave, /remainingGraceSeconds\(since, Date\.now\(\)\)/, 'from the elapsed time, not a decrementing counter');
  const ret = /const handleReturn = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(SRC)?.[1] ?? '';
  assert.match(ret, /stopAwayCountdown\(\);\s*if \(shouldCountAfterReturn\(awayMs\)\) countViolationNow\(\);/, 'back in time → countdown gone, nothing counted');
  const count = /const countViolationNow = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(SRC)?.[1] ?? '';
  assert.match(count, /stopAwayCountdown\(\)/, 'once counted, the countdown gives way to the warning');
  assert.match(count, /setViolationCount\(nextCount\)/, 'the displayed count follows the ref');
});

test('the countdown screen and the warning both show the seconds / the count, and the button is a return', () => {
  const away = /\{awaySeconds !== null && !showWarning \? \(([\s\S]*?)\) : null\}/.exec(SRC)?.[1] ?? '';
  assert.ok(away, 'the away screen exists and yields to the warning once a violation is counted');
  assert.match(away, /\{awaySeconds\}/, 'seconds remaining are on screen');
  assert.match(away, /quiz\.proctor\.violationCount/, 'so is the running count');
  assert.match(away, /onClick=\{\(\) => \{ handleReturn\(\); enterFullscreen\(\); \}\}/, 'the button is a return even where fullscreen is refused');
  const warning = /\{showWarning \? \(([\s\S]*?)\) : null\}/.exec(SRC)?.[1] ?? '';
  assert.match(warning, /quiz\.proctor\.violationCount/, 'the warning shows the count too');
  for (const locale of [zhTW, en]) {
    assert.match(locale['quiz.proctor.violationCount'], /\{count\}/);
    assert.match(locale['quiz.proctor.violationCount'], /\{max\}/);
    assert.equal(typeof locale['quiz.proctor.awayTitle'], 'string');
    assert.equal(typeof locale['quiz.proctor.secondsUnit'], 'string');
  }
});
