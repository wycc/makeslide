/**
 * The settings menu lists the audio.cpp TTS models actually installed, from audio.cpp's own catalog.
 *
 * Built against a throwaway checkout shaped like the real one, so each rule is pinned: installed
 * means every file the catalog lists is there; Qwen3 is given its directory and single-file
 * families their file; packages sharing one value are listed once; non-TTS families are left out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { audioCppCheckoutFor, listInstalledAudioCppModels } from '../src/services/audiocppModels';

function checkout(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audiocpp-models-'));
  const spec = (name: string, body: unknown) =>
    fs.mkdirSync(path.join(root, 'model_specs'), { recursive: true }) === undefined
      ? fs.writeFileSync(path.join(root, 'model_specs', name), JSON.stringify(body))
      : fs.writeFileSync(path.join(root, 'model_specs', name), JSON.stringify(body));
  spec('breeze_tts.json', {
    family: 'breeze_tts', display_name: 'BreezeTTS 2', category: 'tts',
    packages: [
      { id: 'breeze_tts_2_q8_0', display_name: 'BreezeTTS 2 Q8_0 GGUF', default: true, precision: 'q8_0',
        target_directory: 'Breeze-TTS-2-GGUF', files: ['Breeze-TTS-2-GGUF/breeze-tts-2-q8_0.gguf'] },
      { id: 'breeze_tts_2_bf16', display_name: 'BreezeTTS 2 BF16 GGUF', precision: 'bf16',
        target_directory: 'Breeze-TTS-2-GGUF', files: ['Breeze-TTS-2-GGUF/breeze-tts-2-bf16.gguf'] },
    ],
  });
  spec('qwen3_tts.json', {
    family: 'qwen3_tts', display_name: 'Qwen3-TTS', category: 'tts',
    packages: [
      { id: 'qwen3_cv_q8', display_name: 'Qwen3 CustomVoice Q8_0', precision: 'q8_0',
        target_directory: 'Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF', files: ['Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-cv-q8_0.gguf'] },
      { id: 'qwen3_cv_bf16', display_name: 'Qwen3 CustomVoice BF16', precision: 'bf16',
        target_directory: 'Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF', files: ['Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-cv-bf16.gguf'] },
    ],
  });
  spec('whisper.json', {
    family: 'whisper', display_name: 'Whisper', category: 'asr',
    packages: [{ id: 'whisper_small', target_directory: 'Whisper', files: ['Whisper/whisper-small.gguf'] }],
  });
  const put = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(root, 'models', rel)), { recursive: true });
    fs.writeFileSync(path.join(root, 'models', rel), 'x');
  };
  put('Breeze-TTS-2-GGUF/breeze-tts-2-q8_0.gguf');                       // bf16 is NOT installed
  put('Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-cv-q8_0.gguf');
  put('Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-cv-bf16.gguf');        // both precisions present
  put('Whisper/whisper-small.gguf');                                     // installed, but not TTS
  return root;
}

test('only what is installed is offered, with the value each family needs', () => {
  const root = checkout();
  const models = listInstalledAudioCppModels(root);
  assert.deepEqual(models.map((m) => [m.family, m.packageId]), [
    ['breeze_tts', 'breeze_tts_2_q8_0'],
    ['qwen3_tts', 'qwen3_cv_q8'],
  ], '只列出真的裝好的 TTS 模型');
  const breeze = models.find((m) => m.family === 'breeze_tts')!;
  // Breeze keeps two precisions in one directory, so the file is what says which one.
  assert.equal(breeze.path, path.join(root, 'models', 'Breeze-TTS-2-GGUF', 'breeze-tts-2-q8_0.gguf'));
  const qwen = models.find((m) => m.family === 'qwen3_tts')!;
  // Qwen3 gets its directory: the backend switches its three packages by rewriting that name.
  assert.equal(qwen.path, path.join(root, 'models', 'Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF'));
  assert.ok(path.isAbsolute(breeze.path) && path.isAbsolute(qwen.path), 'CLI 收到的是原字串，必須是絕對路徑');
});

test('a package is installed only when all of its files are', () => {
  const root = checkout();
  fs.rmSync(path.join(root, 'models', 'Breeze-TTS-2-GGUF', 'breeze-tts-2-q8_0.gguf'));
  // The directory is still there; that is not the package being there.
  assert.ok(!listInstalledAudioCppModels(root).some((m) => m.family === 'breeze_tts'));
});

test('no catalog, no menu — the page falls back to typing a path', () => {
  assert.deepEqual(listInstalledAudioCppModels(path.join(os.tmpdir(), 'no-such-audiocpp-checkout')), []);
});

test('the checkout is found from where the CLI lives', () => {
  assert.equal(audioCppCheckoutFor('/opt/audio.cpp/build/bin/audiocpp_cli'), '/opt/audio.cpp');
  assert.equal(audioCppCheckoutFor('/opt/audio.cpp/build/linux-cuda-release/bin/audiocpp_cli'), '/opt/audio.cpp');
  // A bare name on PATH says nothing about where the checkout is: the app's own copy is assumed.
  assert.match(audioCppCheckoutFor('audiocpp_cli'), /\.audiocpp$/);
});
