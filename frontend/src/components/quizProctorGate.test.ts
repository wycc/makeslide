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
  assert.match(ret, /stopAwayCountdown\(\);\s*if \(strict && shouldCountAfterReturn\(awayMs\)\) countViolationNow\(\);/, 'back in time → countdown gone, nothing counted');
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

/**
 * 防弊可關閉（使用者要求，2026-09-22）：防弊常誤判，老師可在測驗設定關掉。關閉時離開只警告、
 * 可隨時返回，不自動交卷、重整也不鎖；但每次離開都記下時間與長度，交給老師端列出。
 */
test('with strict off, leaving only warns — no countdown, no violation, no lock on reload', () => {
  const leave = /const handleLeave = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(SRC)?.[1] ?? '';
  assert.match(leave, /if \(!strict\) \{ setShowWarning\(true\); return; \}/, 'lenient mode shows the warning and stops before the grace timer');
  assert.ok(leave.indexOf('if (!strict)') < leave.indexOf('RETURN_GRACE_MS'), 'the lock timer is never armed in lenient mode');
  assert.match(SRC, /isQuizLockedOut\(sessionKey\) \|\| \(strict && isQuizStarted\(sessionKey\)\)/, 'a reload only locks in strict mode');
  assert.match(SRC, /fetchMd\(strict \? 'quiz-rules\.md' : 'quiz-rules-lenient\.md'\)/, 'lenient mode loads rules that do not threaten auto-submit');
  const lenientRules = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../../public/quiz-rules-lenient.md'), 'utf8');
  assert.doesNotMatch(lenientRules, /自動交卷並/, 'the lenient rules do not claim a lockout');
  const warning = /\{showWarning \? \(([\s\S]*?)\) : null\}/.exec(SRC)?.[1] ?? '';
  assert.match(warning, /strict \? 'quiz\.proctor\.warningBody' : 'quiz\.proctor\.lenientWarningBody'/);
  assert.match(warning, /quiz\.proctor\.leaveCount/, 'the lenient warning shows how many leaves are on record');
  for (const locale of [zhTW, en]) {
    assert.match(locale['quiz.proctor.leaveCount'], /\{count\}/);
    assert.equal(typeof locale['quiz.proctor.lenientWarningBody'], 'string');
  }
});

test('every leave is recorded in both modes: added on leave, closed with its duration on return', () => {
  const leave = /const handleLeave = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(SRC)?.[1] ?? '';
  assert.match(leave, /publishLeaves\(\[\.\.\.leavesRef\.current, \{ left_at: new Date\(now\)\.toISOString\(\), away_ms: null \}\]\)/);
  assert.ok(leave.indexOf('publishLeaves(') < leave.indexOf('if (!strict)'), 'recorded before the mode split');
  const ret = /const handleReturn = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(SRC)?.[1] ?? '';
  assert.match(ret, /last\.away_ms === null\) publishLeaves\(\[\.\.\.leaves\.slice\(0, -1\), \{ \.\.\.last, away_ms: awayMs \}\]\)/);
  assert.match(SRC, /onLeavesChangeRef\.current\?\.\(next\)/, 'the page is told about every change');
});
