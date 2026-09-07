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
