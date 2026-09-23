import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  AUDIOCPP_FAMILIES,
  audioCppFamilyOf,
  audioCppHasPackagedSpeakers,
  audioCppModelPathForFamily,
  audioCppModelsRoot,
} from '../../lib/ttsVoices';

/**
 * Switching audio.cpp between Qwen3-TTS and BreezeTTS 2 from the settings page.
 *
 * The family was a free-text box, which is fine until two families need different *other* settings
 * to go with them: Breeze loads a different model file and has no packaged speakers, so a switch
 * that only changed the name left the deck pointed at Qwen3's package with a Qwen3 speaker id —
 * both of which fail on the first segment.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('both families are offered, each with the package it loads', () => {
  assert.deepEqual(AUDIOCPP_FAMILIES.map((f) => f.id), ['qwen3_tts', 'breeze_tts']);
  // Exactly as model_manager_v2.py names them on disk, or the derived path points at nothing.
  assert.equal(AUDIOCPP_FAMILIES[0]!.packagePath, 'Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF');
  assert.equal(AUDIOCPP_FAMILIES[1]!.packagePath, 'Breeze-TTS-2-GGUF/breeze-tts-2-q8_0.gguf');
});

/** This machine's actual settings when the switch was first tried — the case that did not work. */
const ROOT = '/home/wycc/devel/makeslide/.audiocpp';
const QWEN_PATH = `${ROOT}/models/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF`;
const BIN = `${ROOT}/build/bin/audiocpp_cli`;

test('switching from a configured Qwen3 path lands on Breeze under the same models directory', () => {
  // The backend passes the path to the CLI verbatim, so a relative `models/…` does not resolve;
  // and the old rule only replaced a path equal to the other family's *default*, which a real
  // absolute path never is — so the switch left Breeze loading Qwen3's directory.
  assert.equal(
    audioCppModelPathForFamily({ family: 'breeze_tts', currentModel: QWEN_PATH, binPath: BIN }),
    `${ROOT}/models/Breeze-TTS-2-GGUF/breeze-tts-2-q8_0.gguf`,
  );
  // And back again.
  assert.equal(
    audioCppModelPathForFamily({ family: 'qwen3_tts', currentModel: `${ROOT}/models/Breeze-TTS-2-GGUF/breeze-tts-2-q8_0.gguf`, binPath: BIN }),
    QWEN_PATH,
  );
});

test('with no model yet, the models directory comes from where the CLI is', () => {
  assert.equal(audioCppModelsRoot('', BIN), `${ROOT}/models`);
  assert.equal(
    audioCppModelPathForFamily({ family: 'breeze_tts', currentModel: '', binPath: BIN }),
    `${ROOT}/models/Breeze-TTS-2-GGUF/breeze-tts-2-q8_0.gguf`,
  );
});

test('a path already for this family, or somewhere unknown, is left as it is', () => {
  // Qwen3's VoiceDesign package is still Qwen3: switching "to Qwen3" must not undo that choice.
  assert.equal(audioCppModelPathForFamily({ family: 'qwen3_tts', currentModel: `${ROOT}/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF`, binPath: BIN }), null);
  // A hand-typed path to some other model is the user's business.
  assert.equal(audioCppModelPathForFamily({ family: 'breeze_tts', currentModel: '/data/my-models/custom.gguf', binPath: BIN }), null);
  // An unknown family has nothing to derive.
  assert.equal(audioCppModelPathForFamily({ family: 'voxcpm2', currentModel: QWEN_PATH, binPath: BIN }), null);
});

test('a family name is recognised however it is written, and anything else stays free text', () => {
  assert.equal(audioCppFamilyOf('breeze_tts')?.id, 'breeze_tts');
  assert.equal(audioCppFamilyOf('  Breeze_TTS  ')?.id, 'breeze_tts');
  assert.equal(audioCppFamilyOf('qwen3_tts_customvoice')?.id, 'qwen3_tts', '帶套件後綴也算同一家族');
  assert.equal(audioCppFamilyOf('pocket_tts'), null);
});

test('only Qwen3 has speakers to list; an unknown family is assumed to have some', () => {
  assert.equal(audioCppHasPackagedSpeakers('qwen3_tts'), true);
  assert.equal(audioCppHasPackagedSpeakers('breeze_tts'), false, 'Breeze 沒有內建講者，不該列 Qwen3 的九個');
  assert.equal(audioCppHasPackagedSpeakers('voxcpm2'), true, '不認識的家族不要亂猜成沒有');
});

test('the voice picker asks the family before listing speakers', () => {
  const field = read('./AudioCppVoiceField.tsx');
  assert.match(field, /const packagedSpeakers = audioCppHasPackagedSpeakers\(props\.family\)/);
  assert.match(field, /\{\(packagedSpeakers \? AUDIOCPP_QWEN3_VOICES : \[\]\)\.map/);
  // A stored Qwen3 id under Breeze must fall into the free-text box rather than look like a menu
  // entry that family could serve.
  assert.match(field, /!\(packagedSpeakers && isAudioCppQwen3Voice\(trimmed\)\)/);
});

test('the picker uses the derived path, and hands the family to both voice fields', () => {
  const page = read('../SettingsPage.tsx');
  assert.match(page, /audioCppModelPathForFamily\(\{ family: picked\.id, currentModel: audiocppTtsModel, binPath: audiocppTtsBin \}\)/);
  assert.equal((page.match(/family=\{audiocppTtsFamily\}/g) ?? []).length, 2);
});
