import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZH_TW_TTS_INSTRUCTION,
  ttsLanguageInstruction,
  withTtsLanguageInstruction,
} from '../src/services/ttsLanguagePrompt';
import { buildTtsInstructions, hasSpeakerDialog } from '../src/worker/steps/synthesizeAudio';

test('the Chinese steering line is exactly the wording that was asked for', () => {
  assert.equal(ZH_TW_TTS_INSTRUCTION, '請使用台灣用語的繁體中文，以親切且自然的語氣朗讀');
});

test('ttsLanguageInstruction applies to Chinese only', () => {
  assert.equal(ttsLanguageInstruction('zh-TW'), ZH_TW_TTS_INSTRUCTION);
  assert.equal(ttsLanguageInstruction('en'), null);
});

test('withTtsLanguageInstruction prefixes Chinese text in the instruction-plus-colon form', () => {
  // The colon is what makes Google treat the line as steering rather than as words to read;
  // a bare sentence in front of the text is much likelier to be spoken aloud.
  assert.equal(withTtsLanguageInstruction('大家好', 'zh-TW'), `${ZH_TW_TTS_INSTRUCTION}：\n大家好`);
});

test('withTtsLanguageInstruction leaves non-Chinese text completely untouched', () => {
  assert.equal(withTtsLanguageInstruction('Hello there', 'en'), 'Hello there');
});

test('prefixing keeps the speaker labels multi-speaker mode depends on', () => {
  // The labels are how multiSpeakerVoiceConfig assigns the two voices; a prefix that broke the
  // line structure would silently collapse a dialogue onto one voice.
  const dialogue = 'Speaker 1: 早安\nSpeaker 2: 你好';
  const prefixed = withTtsLanguageInstruction(dialogue, 'zh-TW');
  assert.ok(prefixed.includes('\nSpeaker 1: 早安'));
  assert.ok(prefixed.includes('\nSpeaker 2: 你好'));
  assert.equal(hasSpeakerDialog(prefixed), true);
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
