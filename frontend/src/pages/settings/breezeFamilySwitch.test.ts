import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { AUDIOCPP_FAMILIES, audioCppFamilyOf, audioCppHasPackagedSpeakers } from '../../lib/ttsVoices';

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

test('both families are offered, each with the model file it loads', () => {
  assert.deepEqual(AUDIOCPP_FAMILIES.map((f) => f.id), ['qwen3_tts', 'breeze_tts']);
  for (const family of AUDIOCPP_FAMILIES) {
    assert.match(family.defaultModel, /\.gguf$|GGUF/, `${family.id} 要有預設模型路徑`);
  }
  assert.notEqual(AUDIOCPP_FAMILIES[0]!.defaultModel, AUDIOCPP_FAMILIES[1]!.defaultModel);
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

test('switching families brings the model path with it, without overwriting a hand-typed one', () => {
  const page = read('../SettingsPage.tsx');
  assert.match(page, /const picked = AUDIOCPP_FAMILIES\.find\(\(f\) => f\.id === e\.target\.value\)/);
  assert.match(page, /if \(!audiocppTtsModel\.trim\(\) \|\| isDefaultOfAnother\) setAudiocppTtsModel\(picked\.defaultModel\)/);
  // And the picker hands the family to both voice fields, or they would keep listing Qwen3's.
  assert.equal((page.match(/family=\{audiocppTtsFamily\}/g) ?? []).length, 2);
});
