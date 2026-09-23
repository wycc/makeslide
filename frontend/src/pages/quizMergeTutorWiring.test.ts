import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source-level guards for "merge after-class practice" in the quiz history. The backend refuses
 * non-owners itself; these pin that the button follows the same line (the practice records are
 * owner-only, so a public_editable editor must not be offered a button that only answers 403) and
 * that the history reloads afterwards, which is what puts the numbers on each attempt.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const page = fs.readFileSync(path.resolve(here, './QuizBuilderPage.tsx'), 'utf8');

test('the merge button is owner-only, not canEditQuiz', () => {
  assert.match(page, /\{detail\?\.is_owner && pdfId && historySessions\.length > 0 \? \(\s*<button[\s\S]*?handleMergeTutor\(\)/);
});

test('merging reloads the history so every attempt shows its snapshot', () => {
  const handler = page.slice(page.indexOf('const handleMergeTutor = useCallback'), page.indexOf('const loadQuizRecordings = useCallback'));
  assert.match(handler, /await mergeTutorIntoQuiz\(pdfId, historyQuizId\);[\s\S]*?await loadQuizHistory\(historyQuizId\);/);
  assert.match(page, /attempt\.tutor_merged_at && attempt\.tutor_answered != null/);
});
