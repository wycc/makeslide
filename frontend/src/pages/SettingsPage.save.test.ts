import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The settings save handler reads ~46 pieces of state. It used to be a useCallback whose
// hand-maintained dependency array had gone stale — the five OpenRouter TTS fields were never
// added when that provider was — so editing only one of them and pressing Save sent the value
// from whichever earlier render last refreshed the callback. The edit vanished with no error.
//
// These are source-level assertions on purpose: the failure was structural (a memo boundary),
// not behavioural in any single function, and there is no component-rendering harness here.

const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'SettingsPage.tsx'),
  'utf8',
);

/** The payload keys the save request must carry for each TTS provider's speaker settings. */
const REQUIRED_PAYLOAD_KEYS = [
  'openrouter_tts_model',
  'openrouter_tts_speaker1',
  'openrouter_tts_speaker2',
  'openrouter_tts_speaker1_voice',
  'openrouter_tts_speaker2_voice',
  'gemini_tts_model',
  'gemini_tts_speaker1_voice',
  'gemini_tts_speaker2_voice',
  'openai_tts_model',
  'openai_tts_speaker1_voice',
  'openai_tts_speaker2_voice',
  // audio.cpp (local engine): the model/backend pair decides whether it runs at all and whether
  // it runs on the CPU or the GPU, so losing either to a stale closure is the same failure again.
  'audiocpp_tts_model',
  'audiocpp_tts_family',
  'audiocpp_tts_backend',
  'audiocpp_tts_mode',
  'audiocpp_tts_speaker1_voice',
  'audiocpp_tts_speaker2_voice',
];

test('the save handler is not memoized, so no dependency list can drop an edited field', () => {
  // Nothing depends on this handler's identity — it is only ever an onClick — so memoizing it
  // buys nothing and re-introduces the stale-closure hazard for every field added afterwards.
  assert.match(SOURCE, /const onSave = async \(\) => \{/);
  assert.doesNotMatch(SOURCE, /const onSave = useCallback\(/);
});

test('every TTS speaker setting is included in the save payload', () => {
  const payload = /await updateSystemAiSettings\(\{([\s\S]*?)\n {6}\}\);/.exec(SOURCE)?.[1];
  assert.ok(payload, 'could not locate the updateSystemAiSettings payload');
  for (const key of REQUIRED_PAYLOAD_KEYS) {
    assert.match(payload, new RegExp(`\\b${key}:`), `save payload is missing ${key}`);
  }
});

test('each OpenRouter TTS setting is bound to its own state variable', () => {
  // A copy-paste that pointed two fields at one state variable would silently make one of them
  // unsettable — the same "changing it does nothing" symptom, from a different direction.
  const bindings = [
    'openrouter_tts_model: openrouterTtsModel',
    'openrouter_tts_speaker1: openrouterTtsSpeaker1',
    'openrouter_tts_speaker2: openrouterTtsSpeaker2',
    'openrouter_tts_speaker1_voice: openrouterTtsSpeaker1Voice',
    'openrouter_tts_speaker2_voice: openrouterTtsSpeaker2Voice',
  ];
  for (const binding of bindings) {
    assert.ok(SOURCE.includes(binding), `expected the save payload to contain "${binding}"`);
  }
});
