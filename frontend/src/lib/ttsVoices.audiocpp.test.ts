import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import {
  AUDIOCPP_QWEN3_VOICES,
  AUDIOCPP_VOICE_DESIGN,
  isAudioCppQwen3Voice,
  isAudioCppVoiceDesign,
  isAudioCppVoiceReference,
  voiceLabelForProvider,
} from './ttsVoices';

// The speaker ids here have to match the `spk_id` table inside the Qwen3-TTS CustomVoice model —
// audio.cpp looks the name up there and throws "unsupported speaker" on a miss, which fails every
// segment of a deck. These were read out of the model's own config.json on 2026-08-11.
const SPK_ID_FROM_MODEL = [
  'serena',
  'vivian',
  'uncle_fu',
  'ryan',
  'aiden',
  'ono_anna',
  'sohee',
  'eric',
  'dylan',
];

test('the picker offers exactly the speakers the model packages', () => {
  assert.deepEqual(
    [...AUDIOCPP_QWEN3_VOICES.map((v) => v.id)].sort(),
    [...SPK_ID_FROM_MODEL].sort(),
  );
});

test('speaker ids stay lowercase, because that is what the lookup compares', () => {
  // audio.cpp lowercases the name before the table lookup, and the settings value is stored
  // verbatim; keeping the list lowercase means what is saved is what matches.
  for (const voice of AUDIOCPP_QWEN3_VOICES) {
    assert.equal(voice.id, voice.id.toLowerCase());
  }
});

test('every speaker carries a gender, per Qwen\'s published voice list', () => {
  // Four female, five male — from github.com/QwenLM/Qwen3-TTS. Pinned as counts so a typo in one
  // entry cannot quietly turn the picker into an all-male or all-female list.
  const genders = AUDIOCPP_QWEN3_VOICES.map((v) => v.gender);
  assert.equal(genders.filter((g) => g === 'F').length, 4);
  assert.equal(genders.filter((g) => g === 'M').length, 5);
  // The ones a name would get wrong on its own.
  const byId = Object.fromEntries(AUDIOCPP_QWEN3_VOICES.map((v) => [v.id, v]));
  assert.equal(byId.uncle_fu!.gender, 'M');
  assert.equal(byId.dylan!.gender, 'M');
  assert.equal(byId.eric!.gender, 'M');
  assert.equal(byId.ono_anna!.gender, 'F');
  assert.equal(byId.sohee!.gender, 'F');
});

test('the two dialect speakers are labelled as such', () => {
  // spk_is_dialect in the model marks exactly these two; a deck narrated in 四川話 by accident is
  // the kind of thing that only shows up on playback.
  const byId = Object.fromEntries(AUDIOCPP_QWEN3_VOICES.map((v) => [v.id, v]));
  assert.equal(byId.eric!.note, 'zh-sichuan');
  assert.equal(byId.dylan!.note, 'zh-beijing');
});

test('a packaged speaker is recognised regardless of case, a path is not', () => {
  assert.ok(isAudioCppQwen3Voice('vivian'));
  assert.ok(isAudioCppQwen3Voice(' Vivian '));
  assert.ok(!isAudioCppQwen3Voice('/voices/host.wav'));
  assert.ok(!isAudioCppQwen3Voice('alba'));
  assert.ok(!isAudioCppQwen3Voice(''));
});

test('audio.cpp voices are labelled by their raw id, with no gender guessing', () => {
  // The gender tables for OpenAI/Gemini are keyed by their own voice names; running an audio.cpp
  // id through them would silently label it with another provider's guess.
  const labels = { male: '男', female: '女' };
  assert.equal(voiceLabelForProvider('audiocpp', 'vivian', labels), 'vivian');
  assert.equal(voiceLabelForProvider('audiocpp', 'echo', labels), 'echo');
});

test('the Voice Design sentinel is byte-identical to the backend constant', () => {
  // This value crosses the wire and is what the backend turns into `--task vdes` against the
  // VoiceDesign package. If the two drift, the backend reads it as a speaker id instead — which
  // exists in no table, so every segment of the deck fails.
  const backend = readFileSync(
    new URL('../../../backend/src/services/audiocpp.ts', import.meta.url),
    'utf8',
  );
  const declared = /export const AUDIOCPP_VOICE_DESIGN = '([^']*)'/.exec(backend)?.[1];
  assert.equal(declared, AUDIOCPP_VOICE_DESIGN);
});

test('the sentinel is told apart from the two things this field normally holds', () => {
  assert.ok(isAudioCppVoiceDesign(AUDIOCPP_VOICE_DESIGN));
  assert.ok(!isAudioCppVoiceDesign('vivian'));
  assert.ok(!isAudioCppVoiceDesign('/voices/host.wav'));
  // Not a speaker id and not a reference path, or the picker would show it as the wrong mode.
  assert.ok(!isAudioCppQwen3Voice(AUDIOCPP_VOICE_DESIGN));
  assert.ok(!isAudioCppVoiceReference(AUDIOCPP_VOICE_DESIGN));
});

test('an uploaded clip path reads as a reference, whatever its extension', () => {
  assert.ok(isAudioCppVoiceReference('/accounts/me/voice-refs/host-ab12cd34.wav'));
  assert.ok(isAudioCppVoiceReference('recording.m4a'));
  assert.ok(isAudioCppVoiceReference('clip.webm'));
  assert.ok(!isAudioCppVoiceReference('vivian'));
  assert.ok(!isAudioCppVoiceReference(''));
});
