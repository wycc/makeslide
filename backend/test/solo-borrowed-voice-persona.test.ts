/**
 * A segment that borrows Speaker 1's voice borrows Speaker 1's persona too — on audio.cpp.
 *
 * Reported as 「第 1 頁產生失敗：… Voice Design 需要用文字描述聲音，但這位講者的人設是空的」 on a solo
 * deck whose Speaker 1 persona was filled in. The deck's own voice was `nova`, left over from
 * OpenAI and unusable locally, so the page's unlabelled lines fell back to Speaker 1's voice —
 * Voice Design — while the persona, which is only looked up for a "Speaker N:" line, stayed empty.
 * A designed voice with no description to design it from is not a voice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveSpeakerVoice, resolveSpeakerVoiceDetailed } from '../src/worker/steps/synthesizeAudio';
import { AUDIOCPP_VOICE_DESIGN, isAudioCppVoiceUsable } from '../src/services/audiocpp';

const reported = {
  speaker: null as '1' | '2' | null,
  deckVoice: 'nova',                       // an OpenAI name on the deck
  deckSpeaker1Voice: null,
  deckSpeaker2Voice: null,
  globalSpeaker1Voice: AUDIOCPP_VOICE_DESIGN, // what the settings page holds
  globalSpeaker2Voice: AUDIOCPP_VOICE_DESIGN,
  isVoiceUsable: isAudioCppVoiceUsable,
};

test('the reported case: an unlabelled line falls back to Speaker 1, and says so', () => {
  const r = resolveSpeakerVoiceDetailed(reported);
  assert.equal(r.from, 'speaker1', '要知道這個聲音是向 Speaker 1 借來的');
  assert.equal(r.voice.trim(), AUDIOCPP_VOICE_DESIGN.trim());
});

test('each source is reported for what it is', () => {
  assert.equal(resolveSpeakerVoiceDetailed({ ...reported, deckVoice: 'alba' }).from, 'deck', '簡報自己的聲音可用就用它');
  assert.equal(resolveSpeakerVoiceDetailed({ ...reported, speaker: '2' }).from, 'speaker2');
  assert.equal(
    resolveSpeakerVoiceDetailed({ ...reported, globalSpeaker1Voice: null, globalSpeaker2Voice: null }).from,
    'deck-fallback',
    '什麼都沒有時退回簡報的聲音',
  );
});

test('the plain voice answer is unchanged for every caller that only wants the voice', () => {
  assert.equal(resolveSpeakerVoice(reported), resolveSpeakerVoiceDetailed(reported).voice);
  assert.equal(resolveSpeakerVoice({ ...reported, deckVoice: 'alba' }), 'alba');
});

test('the persona follows a borrowed voice on audio.cpp, and only there', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../src/worker/steps/synthesizeAudio.ts', import.meta.url)), 'utf8');
  assert.match(src, /else if \(provider === 'audiocpp' && resolved\.from === 'speaker1'\) segPersona = persona1\?\.trim\(\) \|\| null;/);
  // Labelled lines keep their own rule, ahead of the borrowed one.
  const at = src.indexOf("if (speaker === '1') segPersona = persona1");
  assert.ok(at > 0 && at < src.indexOf("resolved.from === 'speaker1') segPersona"));
});
