import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * No AI prompt may decide the output language for itself.
 *
 * Found three times by users, never by a test, always the same way: output arriving in the wrong
 * language while nothing failed. First the tutor, then the page Q&A, then the add-pages outline —
 * and the third slipped past the guard written for the second, because its prompt named no
 * language at all (「你是簡報內容企劃助理」) and so matched no pattern.
 *
 * The prompts themselves stay in Chinese; they instruct, they are not output. What is banned is
 * hardcoding the language of the *result*.
 */

const ROOT = path.join(import.meta.dirname, '..', 'src');

/** The recurring role-line shape: 「你是（一位）繁體中文…助理/助教/顧問」. */
const ROLE_LINE = /你是(一位)?[^'"`\n]{0,8}(繁體中文|中文)[^'"`\n]{0,12}(助理|助教|顧問|編輯|導師)/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

test("no prompt hardcodes the assistant's language into its role line", () => {
  /** Where naming a language literally is the point. */
  const ALLOWED = new Set([
    'services/contentLanguage.ts',
    // These branch per language already, so both names appear by design.
    'worker/steps/generateTitle.ts',
    'worker/steps/splitTextWithLlm.ts',
    'worker/steps/generateScript.ts',
    'services/promptTemplates.ts',
  ]);
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    if (ALLOWED.has(relative(file))) continue;
    for (const [i, line] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
      if (ROLE_LINE.test(line)) offenders.push(`${relative(file)}:${i + 1}`);
    }
  }
  assert.deepEqual(offenders, [], 'use assistantLanguage(contentLanguage) instead of a fixed language');
});

test('the guard would catch the shape that kept slipping through', () => {
  // Pinned against known-bad strings so a later tidy-up cannot weaken the pattern into one that
  // passes on the very lines it exists to find.
  for (const bad of [
    "content: '你是繁體中文簡報與逐字稿助理。'",
    "'你是一位繁體中文課程設計助理。'",
    "content: '你是繁體中文課堂助教。'",
    "'你是一位繁體中文教學顧問。'",
  ]) {
    assert.ok(ROLE_LINE.test(bad), `should have flagged: ${bad}`);
  }
  assert.ok(!ROLE_LINE.test('content: `你是${lang.name}簡報與逐字稿助理。`'));
});

/**
 * The structural question, which does not depend on how a prompt is worded: does a file that calls
 * the LLM consult the language setting at all? This is what found the eleven the pattern could not.
 */
test('every LLM call site consults the content language', () => {
  const CALLS = /\b(callChatJSON|streamChatText)\s*[<(]/;
  const CONSULTS = /contentLanguage|assistantLanguage|outlineLanguageRule|imageTextLanguageRule|tutorRoleLine|promptLanguageVars|scriptLengthFor|buildRewriteScript|buildImagePrompt|buildSplitMessages|buildTutorTopicsSystemPrompt|buildTutorAssessmentSystemPrompt|AppLanguage/;

  /** Call sites whose output is never prose a reader sees, so the setting does not apply. */
  const EXEMPT = new Set([
    // Coordinates and effect types, not words the audience reads.
    'services/animationAutoFocus.ts',
    // Reads text out of an image; the language is whatever the image already contains.
    'services/reactSlideTextExtract.ts',
    // Generates JavaScript for a sandboxed animation.
    'services/animationCustomScript.ts',
    // The plumbing itself.
    'services/openai.ts',
  ]);

  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    const rel = relative(file);
    if (EXEMPT.has(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (!CALLS.test(source)) continue;
    if (!CONSULTS.test(source)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    'these call the LLM without consulting contentLanguage — their output lands in whatever '
    + 'language the prompt happens to be written in',
  );
});
