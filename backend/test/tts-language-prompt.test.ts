import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZH_TW_TTS_INSTRUCTION,
  buildTtsPromptInstruction,
  ttsLanguageInstruction,
  withTtsPrompt,
} from '../src/services/ttsLanguagePrompt';
import { buildTtsInstructions, hasSpeakerDialog } from '../src/worker/steps/synthesizeAudio';

test('the Chinese steering line is exactly the wording that was asked for', () => {
  assert.equal(ZH_TW_TTS_INSTRUCTION, '請使用台灣用語的繁體中文，以親切且自然的語氣朗讀');
});

test('ttsLanguageInstruction applies to Chinese only', () => {
  assert.equal(ttsLanguageInstruction('zh-TW'), ZH_TW_TTS_INSTRUCTION);
  assert.equal(ttsLanguageInstruction('en'), null);
});

test('a lone instruction keeps the tighter instruction-plus-colon form', () => {
  // The colon is what makes Google treat the line as steering rather than as words to read;
  // a bare sentence in front of the text is much likelier to be spoken aloud.
  assert.equal(withTtsPrompt('大家好', { language: 'zh-TW' }), `${ZH_TW_TTS_INSTRUCTION}：\n大家好`);
});

test('withTtsPrompt leaves text untouched when there is nothing to steer', () => {
  assert.equal(withTtsPrompt('Hello there', { language: 'en' }), 'Hello there');
  assert.equal(withTtsPrompt('Hello there', { language: 'en', persona: '   ' }), 'Hello there');
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

test('a persona still reaches an English deck, which has no language line of its own', () => {
  // And it uses the closing-line form, not a second colon glued onto the persona line's own.
  assert.equal(buildTtsPromptInstruction({ language: 'en', persona: 'calm' }), '朗讀者的角色設定：calm');
  assert.equal(withTtsPrompt('Hi', { language: 'en', persona: 'calm' }), '朗讀者的角色設定：calm\n以下為朗讀內容：\nHi');
});

test('no instruction line ever ends up with a doubled colon before the text', () => {
  const cases: Array<Parameters<typeof withTtsPrompt>[1]> = [
    { language: 'zh-TW' },
    { language: 'zh-TW', persona: '沉穩' },
    { language: 'zh-TW', speaker1Persona: '沉穩', speaker2Persona: '活潑' },
    { language: 'en', persona: 'calm' },
  ];
  for (const params of cases) {
    assert.doesNotMatch(withTtsPrompt('內容', params), /：：/);
  }
});

test('blank personas add no lines', () => {
  assert.equal(
    buildTtsPromptInstruction({ language: 'zh-TW', persona: '  ', speaker1Persona: '', speaker2Persona: null }),
    ZH_TW_TTS_INSTRUCTION,
  );
  assert.equal(buildTtsPromptInstruction({ language: 'en', persona: '  ' }), null);
});

test('only the configured speaker gets a line when the other is empty', () => {
  assert.equal(
    buildTtsPromptInstruction({ language: 'en', speaker1Persona: '沉穩', speaker2Persona: '' }),
    'Speaker 1 的角色設定：沉穩',
  );
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
  // Previously an empty persona meant no instructions at all; Chinese decks need the steering
  // whether or not a persona was configured.
  assert.equal(buildTtsInstructions({ language: 'zh-TW' }), ZH_TW_TTS_INSTRUCTION);
});

test('buildTtsInstructions still returns undefined when there is nothing to say', () => {
  // English with no persona/tone must not start sending an empty instructions field.
  assert.equal(buildTtsInstructions({ language: 'en' }), undefined);
  assert.equal(buildTtsInstructions({}), undefined);
  assert.equal(buildTtsInstructions({ language: 'en', persona: '  ', tone: '  ' }), undefined);
});

test('buildTtsInstructions keeps persona and tone for English decks', () => {
  assert.equal(
    buildTtsInstructions({ language: 'en', persona: 'calm', tone: 'excited' }),
    '角色設定：calm\n這一段的語氣：excited',
  );
});
