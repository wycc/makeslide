import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * No AI prompt may name a language the deck did not choose.
 *
 * This has now been found three times — the tutor, the page Q&A, and eight other features — always
 * the same way: a role line reading 「你是繁體中文…助理」 that no setting could override, so a deck
 * set to English got Chinese quizzes, summaries and answers. Each was reported by a user, because
 * nothing failed; the output was simply in the wrong language.
 *
 * The prompts themselves stay in Chinese (they instruct, they are not output). What is banned is
 * *hardcoding the output language* into one.
 */

const ROOT = path.join(import.meta.dirname, '..', 'src');

/** Where a literal language name is legitimate: the module whose job is to name languages. */
const ALLOWED = new Set([
  path.join(ROOT, 'services', 'contentLanguage.ts'),
  // Prompts with an explicit per-language branch already choose correctly.
  path.join(ROOT, 'worker', 'steps', 'generateTitle.ts'),
  path.join(ROOT, 'worker', 'steps', 'splitTextWithLlm.ts'),
  path.join(ROOT, 'worker', 'steps', 'generateScript.ts'),
  path.join(ROOT, 'services', 'promptTemplates.ts'),
]);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

test('no prompt hardcodes the assistant\'s language into its role line', () => {
  // The shape that keeps recurring: 「你是（一位）繁體中文…助理/顧問/助教」.
  const ROLE_LINE = /你是(一位)?[^'"`\n]{0,8}(繁體中文|中文)[^'"`\n]{0,12}(助理|助教|顧問|編輯|導師)/;
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    if (ALLOWED.has(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const [i, line] of source.split('\n').entries()) {
      if (ROLE_LINE.test(line)) offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'these prompts name a language the deck cannot override — use assistantLanguage(contentLanguage)',
  );
});

test('the guard would catch the shape that kept slipping through', () => {
  // Pins the pattern itself, so a future tidy-up cannot weaken it into something that passes on
  // the very lines this test exists to find.
  const ROLE_LINE = /你是(一位)?[^'"`\n]{0,8}(繁體中文|中文)[^'"`\n]{0,12}(助理|助教|顧問|編輯|導師)/;
  for (const bad of [
    "content: '你是繁體中文簡報與逐字稿助理。'",
    "'你是一位繁體中文課程設計助理。'",
    "content: '你是繁體中文課堂助教。'",
    "'你是一位繁體中文教學顧問。'",
  ]) {
    assert.ok(ROLE_LINE.test(bad), `should have flagged: ${bad}`);
  }
  // And does not flag a prompt that takes its language from the setting.
  assert.ok(!ROLE_LINE.test('content: `你是${lang.name}簡報與逐字稿助理。`'));
});

/**
 * Every file that calls the LLM must decide the output language from the setting.
 *
 * The role-line check above only recognises one phrasing, and the third report came from prompts
 * it could not see: 「你是簡報內容企劃助理」 names no language at all, so nothing flagged it while
 * it produced Chinese outlines for an English deck. This asks the structural question instead —
 * does this file consult contentLanguage at all — which does not depend on how a prompt is worded.
 */
test('every LLM call site consults the content language', (t) => {
  const CALLS = /\b(callChatJSON|streamChatText)\s*[<(]/;
  // Any of these means the file has made a language decision.
  const CONSULTS = /contentLanguage|assistantLanguage|outlineLanguageRule|imageTextLanguageRule|tutorRoleLine|promptLanguageVars|scriptLengthFor|buildRewriteScript|buildImagePrompt|buildSplitMessages|AppLanguage/;
  /** Call sites whose output is never prose a reader sees, so the setting does not apply. */
  const EXEMPT = new Set([
    // Returns coordinates and effect types, not words the audience reads.
    'services/animationAutoFocus.ts',
    // Reads text out of an image; the language is whatever the image already contains.
    'services/reactSlideTextExtract.ts',
    // Generates JavaScript for a sandboxed animation, not text.
    'services/animationCustomScript.ts',
    // The plumbing itself.
    'services/openai.ts',
  ]);

  /**
   * Known gaps: these do produce text someone reads, and do not consult the setting yet.
   *
   * Listed rather than ignored, and reported by the test run, so the debt is visible instead of
   * being discovered one user report at a time — which is how the three fixed so far were found.
   */
  const KNOWN_GAPS = new Set([
    'routes/pdfs/detail.ts',
    'routes/pdfs/generate-poll.ts',
    'routes/pdfs/generate-quiz-question.ts',
    'routes/pdfs/image-quality.ts',
    'routes/pdfs/script-quality.ts',
    'routes/pdfs/tutor-quiz.ts',
    'routes/pdfs/upload.ts',
    'services/notebookGeneration.ts',
    'services/quizEssayGrading.ts',
    'services/reactSlide.ts',
    // Turns a video's captions into slide text — same shape as the add-pages outline just fixed.
    'worker/pipeline.ts',
  ]);

  const offenders: string[] = [];
  const stillOpen: string[] = [];
  for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (EXEMPT.has(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (!CALLS.test(source)) continue;
    if (CONSULTS.test(source)) continue;
    if (KNOWN_GAPS.has(rel)) stillOpen.push(rel);
    else offenders.push(rel);
  }
  if (stillOpen.length > 0) {
    t.diagnostic(`still ignoring the output language: ${stillOpen.join(', ')}`);
  }
  assert.deepEqual(
    offenders,
    [],
    'these call the LLM without ever consulting contentLanguage — their output will be in whatever '
    + 'language the prompt happens to be written in. Use assistantLanguage()/outlineLanguageRule().',
  );
});
