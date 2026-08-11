import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePreviewVoice } from '../src/services/ttsPreview';
import { resolveSpeakerVoice } from '../src/worker/steps/synthesizeAudio';
import { isGeminiVoiceName } from '../src/services/gemini';
import { config } from '../src/config';

// The complaint: the voice heard in Settings was not the voice the deck produced. The preview
// used to treat the form value as the only candidate, so 「沿用設定」 (an empty box) fell into
// normalizeGeminiVoiceName and became 'Kore' — while a real deck went on to the global speaker
// voice. These pin the preview onto the pipeline's own resolution chain.

const runtime = {
  geminiTtsSpeaker1Voice: 'Puck',
  geminiTtsSpeaker2Voice: 'Aoede',
  openaiTtsSpeaker1Voice: 'alloy',
  openaiTtsSpeaker2Voice: 'sage',
  openrouterTtsSpeaker1Voice: 'Charon',
  openrouterTtsSpeaker2Voice: 'Gacrux',
} as unknown as Parameters<typeof resolvePreviewVoice>[0]['runtime'];

test('an empty box inherits that speaker global voice instead of collapsing to Kore', () => {
  assert.equal(resolvePreviewVoice({ provider: 'openrouter', speaker: '1', formVoice: '', runtime }), 'Charon');
  assert.equal(resolvePreviewVoice({ provider: 'openrouter', speaker: '2', formVoice: '', runtime }), 'Gacrux');
});

test('the two speakers inherit different voices, as they do in a deck', () => {
  const s1 = resolvePreviewVoice({ provider: 'openrouter', speaker: '1', formVoice: '', runtime });
  const s2 = resolvePreviewVoice({ provider: 'openrouter', speaker: '2', formVoice: '', runtime });
  assert.notEqual(s1, s2);
});

test('a voice chosen in the form still wins over the global one', () => {
  assert.equal(resolvePreviewVoice({ provider: 'openrouter', speaker: '1', formVoice: 'Leda', runtime }), 'Leda');
});

test('openrouter falls back to the Gemini pair when its own boxes are empty', () => {
  // Matches globalSpeakerVoicesFor: OpenRouter is Gemini TTS, so Gemini's pair is the sane
  // inheritance. The preview must show that rather than a default.
  const inherited = { ...runtime, openrouterTtsSpeaker1Voice: '', openrouterTtsSpeaker2Voice: '' };
  assert.equal(resolvePreviewVoice({ provider: 'openrouter', speaker: '1', formVoice: '', runtime: inherited }), 'Puck');
  assert.equal(resolvePreviewVoice({ provider: 'openrouter', speaker: '2', formVoice: '', runtime: inherited }), 'Aoede');
});

test('an OpenAI voice left in an OpenRouter box is skipped, exactly as the pipeline skips it', () => {
  // Same gate the deck applies: a name from the wrong namespace must not win and then be
  // normalized onto Kore, which is how both hosts once collapsed onto one voice.
  const preview = resolvePreviewVoice({ provider: 'openrouter', speaker: '1', formVoice: 'alloy', runtime });
  const deck = resolveSpeakerVoice({
    speaker: '1',
    deckVoice: 'Kore',
    deckSpeaker1Voice: 'alloy',
    globalSpeaker1Voice: runtime.openrouterTtsSpeaker1Voice,
    isVoiceUsable: isGeminiVoiceName,
  });
  assert.equal(preview, 'Charon');
  assert.equal(preview, deck);
});

test('with nothing configured anywhere the preview lands on the provider default, not silence', () => {
  const empty = {
    geminiTtsSpeaker1Voice: '', geminiTtsSpeaker2Voice: '',
    openaiTtsSpeaker1Voice: '', openaiTtsSpeaker2Voice: '',
    openrouterTtsSpeaker1Voice: '', openrouterTtsSpeaker2Voice: '',
  } as unknown as typeof runtime;
  assert.equal(resolvePreviewVoice({ provider: 'openrouter', speaker: '1', formVoice: '', runtime: empty }), 'Kore');
  assert.equal(resolvePreviewVoice({ provider: 'gemini', speaker: '1', formVoice: '', runtime: empty }), 'Kore');
  assert.equal(
    resolvePreviewVoice({ provider: 'openai', speaker: '1', formVoice: '', runtime: empty }),
    config.openaiTtsVoice,
  );
});

test('openai keeps its own pair and is not put through the Gemini name gate', () => {
  assert.equal(resolvePreviewVoice({ provider: 'openai', speaker: '1', formVoice: '', runtime }), 'alloy');
  assert.equal(resolvePreviewVoice({ provider: 'openai', speaker: '2', formVoice: 'coral', runtime }), 'coral');
});
