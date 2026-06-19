import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GEMINI_TTS_VOICE_GENDER,
  GEMINI_TTS_VOICES,
  OPENAI_TTS_VOICE_GENDER,
  OPENAI_TTS_VOICES,
  geminiVoiceLabel,
  openaiVoiceLabel,
} from './ttsVoices';

// ── geminiVoiceLabel ──────────────────────────────────────────────────────

test('geminiVoiceLabel appends the male marker for a known male voice', () => {
  assert.equal(geminiVoiceLabel('Puck'), 'Puck（男）');
});

test('geminiVoiceLabel appends the female marker for a known female voice', () => {
  assert.equal(geminiVoiceLabel('Kore'), 'Kore（女）');
});

test('geminiVoiceLabel returns the voice name unchanged when it has no gender entry', () => {
  assert.equal(geminiVoiceLabel('NotARealVoice'), 'NotARealVoice');
});

// ── openaiVoiceLabel ──────────────────────────────────────────────────────

test('openaiVoiceLabel appends the male marker for a known male voice', () => {
  assert.equal(openaiVoiceLabel('alloy'), 'alloy（男）');
});

test('openaiVoiceLabel appends the female marker for a known female voice', () => {
  assert.equal(openaiVoiceLabel('nova'), 'nova（女）');
});

test('openaiVoiceLabel returns the voice name unchanged when it has no gender entry', () => {
  assert.equal(openaiVoiceLabel('not-a-real-voice'), 'not-a-real-voice');
});

// ── data-integrity: every listed voice has a gender entry ──────────────────

test('every voice in GEMINI_TTS_VOICES has a corresponding GEMINI_TTS_VOICE_GENDER entry', () => {
  for (const voice of GEMINI_TTS_VOICES) {
    assert.ok(
      GEMINI_TTS_VOICE_GENDER[voice] === 'M' || GEMINI_TTS_VOICE_GENDER[voice] === 'F',
      `expected GEMINI_TTS_VOICE_GENDER to have an M/F entry for "${voice}"`,
    );
  }
});

test('every voice in OPENAI_TTS_VOICES has a corresponding OPENAI_TTS_VOICE_GENDER entry', () => {
  for (const voice of OPENAI_TTS_VOICES) {
    assert.ok(
      OPENAI_TTS_VOICE_GENDER[voice] === 'M' || OPENAI_TTS_VOICE_GENDER[voice] === 'F',
      `expected OPENAI_TTS_VOICE_GENDER to have an M/F entry for "${voice}"`,
    );
  }
});

test('GEMINI_TTS_VOICE_GENDER has no stray entries beyond GEMINI_TTS_VOICES', () => {
  const known = new Set<string>(GEMINI_TTS_VOICES);
  for (const voice of Object.keys(GEMINI_TTS_VOICE_GENDER)) {
    assert.ok(known.has(voice), `GEMINI_TTS_VOICE_GENDER has an entry for "${voice}" not present in GEMINI_TTS_VOICES`);
  }
});

test('OPENAI_TTS_VOICE_GENDER has no stray entries beyond OPENAI_TTS_VOICES', () => {
  const known = new Set<string>(OPENAI_TTS_VOICES);
  for (const voice of Object.keys(OPENAI_TTS_VOICE_GENDER)) {
    assert.ok(known.has(voice), `OPENAI_TTS_VOICE_GENDER has an entry for "${voice}" not present in OPENAI_TTS_VOICES`);
  }
});
