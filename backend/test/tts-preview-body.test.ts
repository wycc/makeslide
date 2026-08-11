import test from 'node:test';
import assert from 'node:assert/strict';
import { TtsPreviewBodySchema } from '../src/routes/pdfs/shared';
import { TTS_PREVIEW_TEXT } from '../src/services/ttsPreview';

// The route-level behaviour lives in tts-preview.test.ts; this file covers the request contract
// and the fixed line without booting the app.

test('the preview line is fixed per language and long enough to judge a persona', () => {
  // A/B-ing two personas only works if the sentence never changes, and a two-word clip would
  // reveal timbre but nothing about pace or delivery — which is what the 人設 field controls.
  for (const language of ['zh-TW', 'en'] as const) {
    assert.ok(TTS_PREVIEW_TEXT[language].length >= 20, `${language} preview line is too short`);
  }
  assert.notEqual(TTS_PREVIEW_TEXT['zh-TW'], TTS_PREVIEW_TEXT.en);
});

test('TtsPreviewBodySchema accepts the three TTS providers and rejects anything else', () => {
  for (const provider of ['openai', 'gemini', 'openrouter'] as const) {
    assert.equal(TtsPreviewBodySchema.safeParse({ provider }).success, true);
  }
  assert.equal(TtsPreviewBodySchema.safeParse({ provider: 'elevenlabs' }).success, false);
  assert.equal(TtsPreviewBodySchema.safeParse({}).success, false);
});

test('TtsPreviewBodySchema defaults voice and persona to empty', () => {
  // An empty persona box is a legitimate thing to preview — it is what the provider sounds like
  // with no steering — so neither field may be required.
  const parsed = TtsPreviewBodySchema.parse({ provider: 'gemini' });
  assert.deepEqual(parsed, { provider: 'gemini', speaker: '1', voice: '', persona: '' });
});

test('TtsPreviewBodySchema carries the speaker, since it decides what an empty voice inherits', () => {
  assert.equal(TtsPreviewBodySchema.parse({ provider: 'gemini', speaker: '2' }).speaker, '2');
  assert.equal(TtsPreviewBodySchema.safeParse({ provider: 'gemini', speaker: '3' }).success, false);
});

test('TtsPreviewBodySchema keeps the unsaved form values it is given', () => {
  // These come from the settings form, not from storage: previewing the stored value would mean
  // saving an untested persona just to hear it.
  const parsed = TtsPreviewBodySchema.parse({ provider: 'openrouter', voice: 'Puck', persona: '沉穩、語速偏慢' });
  assert.equal(parsed.voice, 'Puck');
  assert.equal(parsed.persona, '沉穩、語速偏慢');
});

test('TtsPreviewBodySchema bounds the persona so the preview cannot become a synthesis job', () => {
  assert.equal(TtsPreviewBodySchema.safeParse({ provider: 'gemini', persona: 'a'.repeat(2000) }).success, true);
  assert.equal(TtsPreviewBodySchema.safeParse({ provider: 'gemini', persona: 'a'.repeat(2001) }).success, false);
  assert.equal(TtsPreviewBodySchema.safeParse({ provider: 'gemini', voice: 'v'.repeat(65) }).success, false);
});
