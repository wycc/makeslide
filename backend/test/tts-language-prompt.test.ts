import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EN_TTS_INSTRUCTION,
  ZH_TW_TTS_INSTRUCTION,
  buildTtsPromptInstruction,
  defaultTtsTone,
  ttsLanguageInstruction,
  withTtsPrompt,
} from '../src/services/ttsLanguagePrompt';
import { buildTtsInstructions, hasSpeakerDialog, splitByToneMarkers } from '../src/worker/steps/synthesizeAudio';

/** Any CJK ideograph — used to assert an English request carries no Chinese at all. */
const HAS_CHINESE = /[　-〿一-鿿＀-￯]/;

test('the Chinese steering line is exactly the wording that was asked for', () => {
  assert.equal(ZH_TW_TTS_INSTRUCTION, '請使用台灣用語的繁體中文，以親切且自然的語氣朗讀');
});

test('every language has a steering line, and the English one names the numbers', () => {
  // English decks used to send none. Words carry their own language, digits do not — so "2024"
  // followed whatever language the rest of the request was written in, which was Chinese.
  assert.equal(ttsLanguageInstruction('zh-TW'), ZH_TW_TTS_INSTRUCTION);
  assert.equal(ttsLanguageInstruction('en'), EN_TTS_INSTRUCTION);
  for (const word of ['English', 'number', 'digit', 'year', 'percentage', 'currency']) {
    assert.ok(EN_TTS_INSTRUCTION.includes(word), `English steering line should mention ${word}`);
  }
  assert.doesNotMatch(EN_TTS_INSTRUCTION, HAS_CHINESE);
});

test('a lone instruction keeps the tighter instruction-plus-colon form', () => {
  // The colon is what makes Google treat the line as steering rather than as words to read;
  // a bare sentence in front of the text is much likelier to be spoken aloud.
  assert.equal(withTtsPrompt('大家好', { language: 'zh-TW' }), `${ZH_TW_TTS_INSTRUCTION}：\n大家好`);
  // English gets the same shape with its own colon — a full-width one would be a Chinese cue.
  assert.equal(withTtsPrompt('Hello there', { language: 'en' }), `${EN_TTS_INSTRUCTION}:\nHello there`);
});

test('nothing in an English request is written in Chinese', () => {
  // This is the fix itself: the Chinese frame around English text (persona labels, the closing
  // line, the default tone) was the strongest language signal the model got, and the digits
  // followed it. Every steering string an English deck can produce is checked here.
  const prompts = [
    withTtsPrompt('We shipped 2024 units, up 35%.', { language: 'en' }),
    withTtsPrompt('We shipped 2024 units.', { language: 'en', persona: 'calm' }),
    withTtsPrompt('Speaker 1: Hi\nSpeaker 2: Hello', {
      language: 'en',
      speaker1Persona: 'calm',
      speaker2Persona: 'lively',
    }),
    buildTtsInstructions({ language: 'en' }) ?? '',
    buildTtsInstructions({ language: 'en', persona: 'calm', tone: 'excited' }) ?? '',
    buildTtsInstructions({ language: 'en', tone: defaultTtsTone('en') }) ?? '',
  ];
  for (const prompt of prompts) {
    assert.doesNotMatch(prompt, HAS_CHINESE, `English request must carry no Chinese: ${prompt}`);
  }
});

test('prefixing keeps the speaker labels multi-speaker mode depends on', () => {
  // The labels are how multiSpeakerVoiceConfig assigns the two voices; a prefix that broke the
  // line structure would silently collapse a dialogue onto one voice.
  const dialogue = 'Speaker 1: 早安\nSpeaker 2: 你好';
  const prefixed = withTtsPrompt(dialogue, {
    language: 'zh-TW',
    speaker1Persona: '沉穩',
    speaker2Persona: '活潑',
  });
  assert.ok(prefixed.includes('\nSpeaker 1: 早安'));
  assert.ok(prefixed.includes('\nSpeaker 2: 你好'));
  assert.equal(hasSpeakerDialog(prefixed), true);
});

test('an English persona line never looks like a line of dialogue', () => {
  // `Persona for Speaker 1: …` rather than `Speaker 1: …`: the latter would make a solo page
  // match the multi-speaker test and be synthesized in the wrong mode.
  const solo = withTtsPrompt('Hello there', { language: 'en', persona: 'calm' });
  assert.equal(hasSpeakerDialog(solo), false);
  const dialogue = withTtsPrompt('Speaker 1: Hi\nSpeaker 2: Hello', {
    language: 'en',
    speaker1Persona: 'calm',
    speaker2Persona: 'lively',
  });
  assert.ok(dialogue.includes('Persona for Speaker 1: calm'));
  assert.ok(dialogue.includes('\nSpeaker 1: Hi'));
  assert.equal(hasSpeakerDialog(dialogue), true);
});

// ── personas reaching synthesis on Gemini / OpenRouter ───────────────────
// Those two have no instructions field, so until now the 人設 shaped only the wording the script
// step produced and never the delivery. The prompt is the only channel they have.

test('a solo persona is named as the reader', () => {
  assert.equal(
    buildTtsPromptInstruction({ language: 'zh-TW', persona: '沉穩、語速偏慢' }),
    `${ZH_TW_TTS_INSTRUCTION}\n朗讀者的角色設定：沉穩、語速偏慢`,
  );
});

test('dual-host personas are attributed to the labels the text actually carries', () => {
  // One request voices both hosts, so an unattributed persona would be ambiguous.
  assert.equal(
    buildTtsPromptInstruction({ language: 'zh-TW', speaker1Persona: '沉穩', speaker2Persona: '活潑' }),
    `${ZH_TW_TTS_INSTRUCTION}\nSpeaker 1 的角色設定：沉穩\nSpeaker 2 的角色設定：活潑`,
  );
});

test('several instructions get an explicit closing line before the text', () => {
  // A colon dangling off the last of several unrelated lines no longer reads as "and here is
  // the text to read".
  const prefixed = withTtsPrompt('內容', { language: 'zh-TW', persona: '沉穩' });
  assert.equal(prefixed, `${ZH_TW_TTS_INSTRUCTION}\n朗讀者的角色設定：沉穩\n以下為朗讀內容：\n內容`);
});

test('an English persona rides behind the English language line, in English', () => {
  assert.equal(
    buildTtsPromptInstruction({ language: 'en', persona: 'calm' }),
    `${EN_TTS_INSTRUCTION}\nThe reader's persona: calm`,
  );
  assert.equal(
    withTtsPrompt('Hi', { language: 'en', persona: 'calm' }),
    `${EN_TTS_INSTRUCTION}\nThe reader's persona: calm\nHere is the text to read aloud:\nHi`,
  );
});

test('no instruction line ever ends up with a doubled colon before the text', () => {
  const cases: Array<Parameters<typeof withTtsPrompt>[1]> = [
    { language: 'zh-TW' },
    { language: 'zh-TW', persona: '沉穩' },
    { language: 'zh-TW', speaker1Persona: '沉穩', speaker2Persona: '活潑' },
    { language: 'en' },
    { language: 'en', persona: 'calm' },
    { language: 'en', speaker1Persona: 'calm', speaker2Persona: 'lively' },
  ];
  for (const params of cases) {
    const prefixed = withTtsPrompt('內容', params);
    assert.doesNotMatch(prefixed, /：：/);
    assert.doesNotMatch(prefixed, /::/);
  }
});

test('blank personas add no lines beyond the language one', () => {
  assert.equal(
    buildTtsPromptInstruction({ language: 'zh-TW', persona: '  ', speaker1Persona: '', speaker2Persona: null }),
    ZH_TW_TTS_INSTRUCTION,
  );
  assert.equal(buildTtsPromptInstruction({ language: 'en', persona: '  ' }), EN_TTS_INSTRUCTION);
});

test('only the configured speaker gets a line when the other is empty', () => {
  assert.equal(
    buildTtsPromptInstruction({ language: 'en', speaker1Persona: 'calm', speaker2Persona: '' }),
    `${EN_TTS_INSTRUCTION}\nPersona for Speaker 1: calm`,
  );
});

// ── the default tone, which OpenAI receives on every single segment ──────

test('the default tone is written in the language being read', () => {
  assert.equal(defaultTtsTone('zh-TW'), '平穩敘述');
  assert.doesNotMatch(defaultTtsTone('en'), HAS_CHINESE);
});

test('splitByToneMarkers takes its default tone from the deck language', () => {
  // The unmarked case is the common one, and on OpenAI this string is the request's entire
  // `instructions` when no persona is set — a Chinese sentence attached to English text.
  assert.deepEqual(splitByToneMarkers('We shipped 2024 units.', 'en'), [
    { instruction: defaultTtsTone('en'), text: 'We shipped 2024 units.' },
  ]);
  assert.deepEqual(splitByToneMarkers('大家好'), [{ instruction: '平穩敘述', text: '大家好' }]);
  // An explicit marker still wins over the default, in either language.
  assert.deepEqual(splitByToneMarkers('[[ excited ]]Great news!', 'en'), [
    { instruction: 'excited', text: 'Great news!' },
  ]);
});

test('buildTtsInstructions leads with the language line, then persona, then per-segment tone', () => {
  // Order is deliberate: the later, more specific lines refine the language guidance instead of
  // arguing with it.
  assert.equal(
    buildTtsInstructions({ language: 'zh-TW', persona: '沉穩', tone: '興奮地' }),
    `${ZH_TW_TTS_INSTRUCTION}\n角色設定：沉穩\n這一段的語氣：興奮地`,
  );
});

test('buildTtsInstructions sends the language line even with no persona or tone', () => {
  // Previously an empty persona meant no instructions at all; decks need the steering whether or
  // not a persona was configured — the English one most of all, since it is what keeps digits
  // from being read in Chinese.
  assert.equal(buildTtsInstructions({ language: 'zh-TW' }), ZH_TW_TTS_INSTRUCTION);
  assert.equal(buildTtsInstructions({ language: 'en' }), EN_TTS_INSTRUCTION);
});

test('buildTtsInstructions still returns undefined when there is no language and nothing to say', () => {
  assert.equal(buildTtsInstructions({}), undefined);
  assert.equal(buildTtsInstructions({ persona: '  ', tone: '  ' }), undefined);
});

test('buildTtsInstructions labels an English persona and tone in English', () => {
  assert.equal(
    buildTtsInstructions({ language: 'en', persona: 'calm', tone: 'excited' }),
    `${EN_TTS_INSTRUCTION}\nPersona: calm\nTone for this passage: excited`,
  );
});

test('a caller with no deck language keeps the original Chinese labels', () => {
  // `language` is optional on this one, and the callers that omit it predate the setting.
  assert.equal(buildTtsInstructions({ persona: '沉穩', tone: '興奮地' }), '角色設定：沉穩\n這一段的語氣：興奮地');
});
