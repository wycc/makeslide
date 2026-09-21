import test from 'node:test';
import assert from 'node:assert/strict';
import { providerFieldVisibility } from './providerFieldVisibility';

const base = { llmProvider: 'openai', ttsProvider: 'openai', secondaryLlmProvider: '', secondaryTtsProvider: '' };

test('only the selected provider is visible; the others are hidden entirely', () => {
  const v = providerFieldVisibility(base);
  assert.equal(v.credentials('openai'), true);
  assert.equal(v.llm('openai'), true);
  assert.equal(v.tts('openai'), true);
  for (const other of ['gemini', 'cgu-air', 'openrouter', 'audiocpp']) {
    assert.equal(v.credentials(other), false, `${other} credentials should be hidden`);
    assert.equal(v.llm(other), false, `${other} LLM fields should be hidden`);
    assert.equal(v.tts(other), false, `${other} TTS fields should be hidden`);
  }
});

test('credentials follow any role, model fields follow only their own role', () => {
  // Gemini for text, OpenAI for speech: the Gemini key shows (LLM role) but not its TTS
  // speakers; the OpenAI key shows (TTS role) but not its LLM model.
  const v = providerFieldVisibility({ ...base, llmProvider: 'gemini', ttsProvider: 'openai' });
  assert.equal(v.credentials('gemini'), true);
  assert.equal(v.llm('gemini'), true);
  assert.equal(v.tts('gemini'), false);
  assert.equal(v.credentials('openai'), true);
  assert.equal(v.llm('openai'), false);
  assert.equal(v.tts('openai'), true);
});

test('secondary (fallback) providers count as selected', () => {
  const v = providerFieldVisibility({ ...base, secondaryLlmProvider: 'openrouter', secondaryTtsProvider: 'audiocpp' });
  assert.equal(v.credentials('openrouter'), true);
  assert.equal(v.llm('openrouter'), true);
  assert.equal(v.tts('openrouter'), false);
  assert.equal(v.tts('audiocpp'), true);
  assert.equal(v.credentials('cgu-air'), false);
});

test('an empty secondary selection never makes the empty-string provider visible', () => {
  const v = providerFieldVisibility(base);
  assert.equal(v.credentials(''), false);
  assert.equal(v.llm(''), false);
  assert.equal(v.tts(''), false);
});

test('showAll reveals every provider regardless of selection', () => {
  const v = providerFieldVisibility({ ...base, showAll: true });
  for (const p of ['openai', 'gemini', 'cgu-air', 'openrouter', 'audiocpp']) {
    assert.equal(v.credentials(p), true);
    assert.equal(v.llm(p), true);
    assert.equal(v.tts(p), true);
  }
});

// 圖片供應商設定（使用者要求，2026-09-22）：'' 跟著 LLM 走，否則固定用該服務；Qwen 只有圖片角色，
// 固定選它時金鑰欄位也要露出來。
test('image fields follow the LLM providers by default and the pinned image provider otherwise', () => {
  const auto = providerFieldVisibility({ ...base, llmProvider: 'cgu-air', secondaryLlmProvider: 'openai' });
  assert.equal(auto.image('cgu-air'), true);
  assert.equal(auto.image('openai'), true);
  assert.equal(auto.image('gemini'), false);
  assert.equal(auto.image('qwen'), false);
  assert.equal(auto.credentials('qwen'), false);

  const pinned = providerFieldVisibility({ ...base, llmProvider: 'cgu-air', imageProvider: 'qwen' });
  assert.equal(pinned.image('qwen'), true);
  assert.equal(pinned.credentials('qwen'), true, 'the Qwen key has no other role to be revealed by');
  assert.equal(pinned.image('cgu-air'), false, 'images no longer follow the LLM provider');
  assert.equal(pinned.llm('cgu-air'), true, 'the LLM model field is unaffected');
  assert.equal(pinned.image(''), false);

  const gemini = providerFieldVisibility({ ...base, imageProvider: 'gemini' });
  assert.equal(gemini.image('gemini'), true);
  assert.equal(gemini.credentials('gemini'), true);
  assert.equal(gemini.image('openai'), false);
  assert.equal(providerFieldVisibility({ ...base, showAll: true }).image('qwen'), true);
});
