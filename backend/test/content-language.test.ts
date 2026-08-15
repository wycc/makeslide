import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config';
import { loadPromptTemplate, renderPromptTemplate } from '../src/services/promptTemplates';
import {
  contentLanguageInstruction,
  contentLanguageName,
  outlineLanguageRule,
  scriptLengthFor,
  promptLanguageVars,
} from '../src/services/contentLanguage';
import { buildSystemPrompt, buildUserText } from '../src/worker/steps/generateScript';

// Every template a script goes through, in either direction (generate, per-page rewrite, deck
// rewrite). They are listed by path rather than discovered so that adding one without teaching it
// about the language setting is a test failure rather than a silent Chinese deck.
const SCRIPT_TEMPLATES = [
  'backend/prompts/generate-script-openai.md',
  'backend/prompts/generate-script-openai-dual.md',
  'backend/prompts/generate-script-gemini.md',
  'backend/prompts/generate-script-gemini-solo.md',
  'backend/prompts/generate-script-usertext.md',
  'backend/prompts/rewrite-script-openai.md',
  'backend/prompts/rewrite-script-gemini.md',
  'backend/prompts/rewrite-script-gemini-solo.md',
];

const FILLER_VARS = {
  target_chars: '350',
  min_chars: '280',
  max_chars: '420',
  page_number: '3',
  page_count: '12',
  previous_block: '',
  next_block: '',
  page_text_block: '',
  extra_source_block: '',
};

function render(relPath: string, language: 'zh-TW' | 'en'): string {
  const template = loadPromptTemplate(relPath, '');
  assert.notEqual(template, '', `${relPath} is missing`);
  return renderPromptTemplate(template, { ...FILLER_VARS, ...promptLanguageVars(language) });
}

test('no script template hardcodes the output language any more', () => {
  // The setting was read correctly all along; what beat it was the templates themselves, which
  // opened with 「你是一位專業的中文簡報講師」 and repeated 「使用繁體中文」 in their rules. A
  // single 【輸出語言】 line appended after all that does not win.
  for (const relPath of SCRIPT_TEMPLATES) {
    const raw = fs.readFileSync(path.join(config.repoRoot, relPath), 'utf8');
    assert.ok(
      !/繁體中文|台灣用語/.test(raw),
      `${relPath} still states a language of its own; it must use {{language}}/{{language_notes}}`,
    );
    assert.ok(/\{\{\s*language\s*\}\}/.test(raw), `${relPath} never states the language at all`);
  }
});

test('every script template renders cleanly in both languages', () => {
  for (const relPath of SCRIPT_TEMPLATES) {
    for (const language of ['zh-TW', 'en'] as const) {
      const out = render(relPath, language);
      assert.ok(out.includes(contentLanguageName(language)), `${relPath} (${language}) omits the language`);
      // "{{}}" and "{{溫和}}" are literal text in the tone-tag rules ("do not use this syntax"),
      // and the renderer only substitutes ASCII names — so only a real variable may be left over.
      const leftover = out.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g);
      assert.equal(leftover, null, `${relPath} (${language}) left ${leftover?.join(', ')} unresolved`);
    }
  }
});

test('an English deck is not told to write Chinese anywhere in its script prompt', () => {
  for (const relPath of SCRIPT_TEMPLATES) {
    const out = render(relPath, 'en');
    assert.ok(!out.includes('逐字稿使用繁體中文'), relPath);
    assert.ok(!out.includes('台灣用語'), relPath);
    // The Chinese filler words were instructions to write Chinese, whatever the language line said.
    assert.ok(!out.includes('「那我們來看」'), relPath);
  }
});

test('the length target is converted to words for English, not read as characters', () => {
  // The stored target is a Chinese character count. Read as characters an English script comes out
  // about a third of the intended length; read as words, three times too long. It means "about
  // this much speech", so it is converted through duration (~270 chars/min vs ~140 words/min).
  const bounds = { min: 280, max: 420 };
  assert.deepEqual(scriptLengthFor('zh-TW', 350, bounds), { target: 350, min: 280, max: 420, unit: '字' });
  const en = scriptLengthFor('en', 350, bounds);
  assert.equal(en.unit, 'words');
  assert.equal(en.target, 181);
  assert.ok(en.min < en.target && en.target < en.max, JSON.stringify(en));
  // Both come out around 78 seconds of speech, which is what the number actually stands for.
  const seconds = (n: number, perMinute: number) => (n / perMinute) * 60;
  assert.ok(Math.abs(seconds(350, 270) - seconds(en.target, 140)) < 3);
});

test('the assembled English prompt states words, and explains the unit once', () => {
  const system = buildSystemPrompt(null, 350, 'openai', undefined, undefined, 'en', 'solo');
  assert.match(system, /181 words/);
  assert.ok(!/350 字/.test(system), 'the Chinese character figure must not appear');
  assert.equal((system.match(/英文單字數/g) ?? []).length, 1);
});

test('the whole assembled script prompt agrees with the setting, system and user message alike', () => {
  // The user message is where the two halves used to disagree: it stated OPENAI_SCRIPT_LANGUAGE
  // (zh-TW, an operator env var) on every page while the system prompt said English — and being
  // closer to the task, it won. The deck came back with an English title and Chinese scripts.
  for (const hostMode of ['solo', 'dual'] as const) {
    for (const ttsProvider of ['openai', 'gemini'] as const) {
      const system = buildSystemPrompt(null, 350, ttsProvider, undefined, undefined, 'en', hostMode);
      assert.ok(system.includes('英文'), `${hostMode}/${ttsProvider}: system prompt never asks for English`);
      assert.ok(
        !system.includes('繁體中文'),
        `${hostMode}/${ttsProvider}: system prompt still asks for Traditional Chinese`,
      );
    }
  }
  const user = buildUserText({
    pageNumber: 3,
    pageCount: 12,
    targetChars: 350,
    pageText: '深度學習的三個階段',
    pageEmpty: false,
    previousContext: '',
    nextContext: '',
    extraSourcesText: '',
    contentLanguage: 'en',
  });
  assert.ok(user.includes('輸出語言：英文（English）'));
  assert.ok(!/輸出語言：zh-TW|（繁體中文）/.test(user));
});

test('the slide outline is written in the output language, one step before the image is drawn', () => {
  // The outline's title and bullets become the page content quoted into the image prompt. An
  // outline in the wrong language hands the image model Chinese to copy, whatever the image rule
  // says — so both rules exist, and both name the language explicitly.
  assert.ok(outlineLanguageRule('en').includes('英文'));
  assert.ok(outlineLanguageRule('zh-TW').includes('繁體中文'));
  assert.notEqual(outlineLanguageRule('en'), outlineLanguageRule('zh-TW'));
});

test('the language instruction says what to do when the source is in the other language', () => {
  // An English PDF narrated in Chinese is the normal case, so "use English" alone loses to the
  // material in front of the model.
  assert.ok(contentLanguageInstruction('en').includes('翻譯'));
  assert.ok(contentLanguageInstruction('zh-TW').includes('翻譯'));
});
