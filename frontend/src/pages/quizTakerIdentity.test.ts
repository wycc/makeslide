import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../locales/zh-TW';
import { en } from '../locales/en';

// 作答時顯示使用者代碼方便識別（使用者要求，2026-09-15）。原始碼層級守門。
const SRC = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'QuizBuilderPage.tsx'), 'utf8');

test('the quiz-taking view shows the student code (and login name), and warns when no code is set', () => {
  const view = /const renderQuizTakingView = \(quiz: QuizSet\) => \{([\s\S]*?)\n  \};/.exec(SRC)?.[1] ?? '';
  assert.ok(view, 'taking view found');
  assert.match(view, /formatMessage\('quiz\.takerCode', \{ code: takerIdentity\.code \}\)/, 'code shown');
  assert.match(view, /t\('quiz\.takerCodeMissing'\)/, 'missing code is visible, not blank');
  assert.match(view, /t\('quiz\.takerCodeMissingHint'\)/, 'and says where to set it');
  assert.match(view, /formatMessage\('quiz\.takerName', \{ name: takerIdentity\.name \}\)/, 'login name shown when known');
  assert.match(SRC, /const code = await resolveConfiguredUserCode\(\);[\s\S]*?getAuthStatus\(\)/, 'identity resolved from the same code source the attempt uses');
  for (const locale of [zhTW, en]) {
    assert.match(locale['quiz.takerCode'], /\{code\}/);
    assert.match(locale['quiz.takerName'], /\{name\}/);
    assert.equal(typeof locale['quiz.takerCodeMissing'], 'string');
    assert.equal(typeof locale['quiz.takerCodeMissingHint'], 'string');
  }
});

test("the student's own progress reports carry the user code so the teacher's list shows it; the master's re-entry report does not", () => {
  assert.match(SRC, /const reportOwnProgress = useCallback\([\s\S]*?resolveConfiguredUserCode\(\);[\s\S]*?user_code: code \|\| undefined/, 'helper resolves and attaches the code');
  const own = SRC.match(/reportOwnProgress\(pdfId, clientId, \{/g) ?? [];
  assert.equal(own.length, 5, 'debounced progress, leave log, finish, re-entry reset, answer reset');
  assert.equal((SRC.match(/submitSyncQuizProgress\(pdfId, clientId, \{/g) ?? []).length, 0, 'no student report bypasses the helper');
  assert.match(SRC, /submitSyncQuizProgress\(pdfId, progress\.client_id, \{/, "the master's allow-reentry report stays code-less");
});
