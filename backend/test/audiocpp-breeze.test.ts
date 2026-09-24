/**
 * BreezeTTS 2 alongside Qwen3-TTS.
 *
 * The two are the opposite shape and the settings only carry a family name, so every rule that
 * used to mean "Qwen3 or not" now has to mean the right thing for both. None of these differences
 * produces a wrong-sounding voice — each one aborts the run, or silently drops the persona:
 *
 *  - Qwen3 clones on `tts`; Breeze cloning is its own task, `clon`.
 *  - Qwen3 designs on `vdes` with its own package; Breeze designs on an ordinary `tts` call.
 *  - Qwen3 reads the persona from `--instruct`; Breeze reads the option `instruction`, which has
 *    no flag of its own.
 *  - Qwen3 has nine packaged speakers; Breeze has none, so a bare voice name cannot be sent at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIOCPP_VOICE_DESIGN,
  audioCppDesignNeedsCli,
  audioCppEffectiveVoice,
  audioCppInstructArgs,
  audioCppModelPathForMode,
  audioCppSupportsInstruct,
  audioCppTaskFor,
  audioCppVoiceFlag,
  buildAudioCppCliArgs,
  buildAudioCppSpeechBody,
  isBreezeTtsFamily,
  isQwen3TtsFamily,
} from '../src/services/audiocpp';

const BREEZE = 'breeze_tts';
const MODEL = 'models/Breeze-TTS-2-GGUF/breeze-tts-2-q8_0.gguf';
const base = {
  binPath: 'audiocpp_cli',
  modelPath: MODEL,
  family: BREEZE,
  backend: 'cuda' as const,
  text: '大家好',
  voice: '',
  outPath: '/tmp/out.wav',
  device: null,
  threads: null,
  loadOptions: [] as string[],
};

test('the two families are told apart, and neither answers for the other', () => {
  assert.equal(isBreezeTtsFamily('breeze_tts'), true);
  assert.equal(isBreezeTtsFamily('BREEZE_TTS'), true, '大小寫不該影響');
  assert.equal(isBreezeTtsFamily('qwen3_tts'), false);
  assert.equal(isQwen3TtsFamily('breeze_tts'), false);
  assert.equal(isBreezeTtsFamily('pocket_tts'), false);
});

test('cloning is a different task for each family', () => {
  assert.equal(audioCppTaskFor('reference', BREEZE), 'clon', 'BreezeTTS 2 的語音複製是自己的 task');
  assert.equal(audioCppTaskFor('reference', 'qwen3_tts'), 'tts');
  assert.equal(audioCppTaskFor('speaker', BREEZE), 'tts');
});

test('designing a voice is an ordinary tts call for Breeze, and its own task for Qwen3', () => {
  assert.equal(audioCppTaskFor('design', BREEZE), 'tts');
  assert.equal(audioCppTaskFor('design', 'qwen3_tts'), 'vdes');
  // Which is why the OpenAI-compatible endpoint can serve a designed Breeze voice but not a Qwen3
  // one: there is no field on it for asking for another task.
  assert.equal(audioCppDesignNeedsCli(BREEZE), false);
  assert.equal(audioCppDesignNeedsCli('qwen3_tts'), true);
});

test('the persona reaches Breeze as the option it actually reads', () => {
  // `--instruct` sets the option `instruct`; BreezeTTS reads `instruction` and nothing else, so the
  // wrong one is not an error — the voice is just never steered.
  // With the guidance that makes it followed (AUDIOCPP_BREEZE_GUIDANCE_SCALE, default 4).
  assert.deepEqual(audioCppInstructArgs(BREEZE, '沉穩的女聲'), [
    '--request-option', 'instruction=沉穩的女聲',
    '--request-option', 'guidance_scale=4',
  ]);
  assert.deepEqual(audioCppInstructArgs('qwen3_tts', '沉穩的女聲'), ['--instruct', '沉穩的女聲']);
  assert.deepEqual(audioCppInstructArgs('pocket_tts', '沉穩的女聲'), [], '沒有指令欄位的家族不該收到');
  assert.deepEqual(audioCppInstructArgs(BREEZE, '   '), []);
  assert.equal(audioCppSupportsInstruct(BREEZE), true);
});

test('a bare voice name is never sent to Breeze', () => {
  // It has no speaker table: `--voice-id` and `--speaker` both fail the run, and the voice is
  // supposed to come from the instruction anyway.
  assert.equal(audioCppVoiceFlag({ voice: 'vivian', family: BREEZE }), null);
  assert.equal(audioCppVoiceFlag({ voice: '/srv/refs/a.wav', family: BREEZE }), '--voice-ref', '參考音檔還是要送');
  // And an empty voice stays empty rather than picking up Qwen3's fallback speaker.
  assert.equal(audioCppEffectiveVoice({ voice: '', family: BREEZE }), '');
});

test('a plain Breeze request: tts, no voice flag, the persona as an option', () => {
  const args = buildAudioCppCliArgs({ ...base, persona: '溫暖的男聲，語速平穩' });
  assert.deepEqual(args, [
    '--task', 'tts',
    '--model', MODEL,
    '--family', BREEZE,
    '--backend', 'cuda',
    '--request-option', 'instruction=溫暖的男聲，語速平穩',
    '--request-option', 'guidance_scale=4',
    '--text', '大家好',
    '--out', '/tmp/out.wav',
  ]);
});

test('cloning a voice: the clone task, the clip, and its transcript', () => {
  const args = buildAudioCppCliArgs({
    ...base,
    voice: '/srv/refs/narrator.wav',
    referenceText: 'This is the reference clip.',
    persona: '照著這個聲音念',
  });
  assert.equal(args[1], 'clon');
  assert.ok(args.includes('--voice-ref') && args.includes('/srv/refs/narrator.wav'));
  assert.deepEqual(args.slice(args.indexOf('--reference-text'), args.indexOf('--reference-text') + 2),
    ['--reference-text', 'This is the reference clip.']);
  assert.ok(args.includes('instruction=照著這個聲音念'));
});

test('a designed Breeze voice runs as tts with no voice at all', () => {
  const args = buildAudioCppCliArgs({ ...base, voice: AUDIOCPP_VOICE_DESIGN, persona: '低沉的旁白' });
  assert.equal(args[1], 'tts', 'Breeze 沒有 vdes');
  assert.ok(!args.includes('--voice-id') && !args.includes('--speaker') && !args.includes('--voice-ref'));
  assert.ok(args.includes('instruction=低沉的旁白'), '設計出來的聲音就是這段文字');
});

test('the model path is left alone: Breeze ships one package, not three', () => {
  // The Qwen3 rule swaps CustomVoice/VoiceDesign/Base in the path. Applying it here would point
  // the family at a file that does not exist.
  assert.equal(audioCppModelPathForMode(MODEL, 'design'), null);
  assert.equal(audioCppModelPathForMode(MODEL, 'reference'), null);
});

test('over the speech endpoint the persona rides the field the server maps to `instruction`', () => {
  const body = buildAudioCppSpeechBody({ model: 'breeze', text: '大家好', voice: '', persona: '溫暖的女聲', family: BREEZE });
  assert.equal(body.instructions, '溫暖的女聲');
  assert.equal(body.voice, undefined, '沒有內建講者可送');
});

test('Qwen3 is untouched by all of this', () => {
  const args = buildAudioCppCliArgs({
    ...base,
    family: 'qwen3_tts',
    modelPath: '/models/Qwen3-TTS-CustomVoice-GGUF',
    voice: 'vivian',
    persona: '沉穩的女聲',
  });
  assert.equal(args[1], 'tts');
  assert.ok(args.includes('--speaker') && args.includes('vivian'));
  assert.deepEqual(args.slice(args.indexOf('--instruct'), args.indexOf('--instruct') + 2), ['--instruct', '沉穩的女聲']);
  assert.ok(!args.includes('--request-option'));
});

// --- Found by running the real binary, not by reading the docs --------------------------------

import { audioCppCloneNeedsTranscript, isBackendUnavailableError } from '../src/services/audiocpp';

/** What `audiocpp_cli` v0.8.2 actually printed for a Breeze clone with no transcript. */
const REAL_BREEZE_CLONE_STDERR = [
  'ggml_cuda_init: found 1 CUDA devices (Total VRAM: 24121 MiB):',
  '  Device 0: NVIDIA RTX A5000, compute capability 8.6, VMM: yes, VRAM: 24121 MiB',
  'ggml_backend_cuda_graph_compute: CUDA graph warmup complete',
  'audiocpp_cli failed: BreezeTTS clone requires reference_text',
].join('\n');

test('a Breeze clone needs its transcript, whatever its own docs say', () => {
  // docs/models/breeze_tts.md lists `reference_text` as defaulting to empty; the engine refuses
  // without it. Checked up front, the user gets a sentence about the missing transcript instead of
  // a GPU run that was always going to fail.
  assert.equal(audioCppCloneNeedsTranscript('breeze_tts'), true);
  assert.equal(audioCppCloneNeedsTranscript('qwen3_tts'), true);
  assert.equal(audioCppCloneNeedsTranscript('pocket_tts'), false, '其他家族不擋');
});

test('an ordinary failure on a GPU machine is not mistaken for the GPU being unavailable', () => {
  // Every CUDA run announces the device; matching "cuda" anywhere made every failure — this one is
  // a missing transcript — run again on the CPU, doubling the wait before the real error.
  assert.equal(isBackendUnavailableError(REAL_BREEZE_CLONE_STDERR), false, '缺逐字稿不是 GPU 的問題，不該改用 CPU 重跑');
});

test('a real device problem is still recognised', () => {
  assert.equal(isBackendUnavailableError('audiocpp_cli failed: CUDA error: out of memory'), true);
  assert.equal(isBackendUnavailableError('ggml_cuda_init: no CUDA devices found'), true, '找不到 GPU 仍然要改用 CPU');
  assert.equal(isBackendUnavailableError('audiocpp_cli failed: backend vulkan not compiled in'), true);
  // With only the start-up banner and no verdict line, the banner alone must not trip it.
  assert.equal(isBackendUnavailableError('ggml_cuda_init: found 1 CUDA devices (Total VRAM: 24121 MiB):\nsegfault'), false);
});
