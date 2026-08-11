import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIOCPP_BACKENDS,
  audioCppSpeechUrl,
  audioCppVoiceOrEmpty,
  buildAudioCppCliArgs,
  buildAudioCppSpeechBody,
  detectAudioCppBackend,
  effectiveAudioCppMode,
  isAudioCppVoiceUsable,
  isBackendUnavailableError,
  looksLikeVoiceReference,
  resolveAudioCppBackend,
  resetAudioCppBackendCache,
  type AudioCppSettings,
} from '../src/services/audiocpp';
import { buildAtempoFilter, buildSegmentLoudnessConcatArgs, ttsModelLabelFor } from '../src/worker/steps/synthesizeAudio';
import { globalSpeakerVoicesFor, speakerPersonasFor } from '../src/services/aiSettings';
import { hasProviderKey, isKeylessProvider } from '../src/services/providerAvailability';
import { estimateTtsCostUsd } from '../src/services/llmUsage';

// --- CPU / GPU selection -----------------------------------------------------------------

test('auto-detection prefers the vendor backend that matches the machine', () => {
  assert.equal(detectAudioCppBackend({ platform: 'darwin', hasNvidia: false, hasRocm: false }), 'metal');
  assert.equal(detectAudioCppBackend({ platform: 'linux', hasNvidia: true, hasRocm: false }), 'cuda');
  assert.equal(detectAudioCppBackend({ platform: 'linux', hasNvidia: false, hasRocm: true }), 'hip');
  // The one that always works, and therefore the only safe default.
  assert.equal(detectAudioCppBackend({ platform: 'linux', hasNvidia: false, hasRocm: false }), 'cpu');
});

test('macOS takes Metal even next to an NVIDIA-looking probe', () => {
  // Metal is always present there, so probing further would only add a way to get it wrong.
  assert.equal(detectAudioCppBackend({ platform: 'darwin', hasNvidia: true, hasRocm: true }), 'metal');
});

test('an explicit backend is passed through untouched, only "auto" probes', () => {
  resetAudioCppBackendCache();
  assert.equal(resolveAudioCppBackend('cpu'), 'cpu');
  assert.equal(resolveAudioCppBackend('CUDA'), 'cuda');
  assert.equal(resolveAudioCppBackend(' vulkan '), 'vulkan');
  // Anything unrecognised is treated as 'auto' rather than handed to the CLI verbatim.
  const probed = resolveAudioCppBackend('nonsense');
  assert.ok(['cpu', 'cuda', 'hip', 'metal'].includes(probed));
});

// --- CLI arguments -----------------------------------------------------------------------

const baseCliParams = {
  binPath: 'audiocpp_cli',
  modelPath: '/models/pocket-tts',
  family: 'pocket_tts',
  backend: 'cuda' as const,
  text: '大家好',
  voice: 'alba',
  outPath: '/tmp/out.wav',
  device: null,
  threads: null,
  loadOptions: [] as string[],
};

test('the CLI invocation carries task, model, family, backend and output', () => {
  const args = buildAudioCppCliArgs(baseCliParams);
  assert.deepEqual(args, [
    '--task', 'tts',
    '--model', '/models/pocket-tts',
    '--family', 'pocket_tts',
    '--backend', 'cuda',
    '--voice-id', 'alba',
    '--text', '大家好',
    '--out', '/tmp/out.wav',
  ]);
});

test('the compute backend really does reach the command line', () => {
  // This is the whole CPU/GPU feature: if the flag stopped being emitted, every run would
  // silently use whatever audio.cpp defaults to and nobody would see an error.
  for (const backend of AUDIOCPP_BACKENDS) {
    const args = buildAudioCppCliArgs({ ...baseCliParams, backend });
    assert.equal(args[args.indexOf('--backend') + 1], backend);
  }
});

test('every backend we offer is one the real CLI accepts', () => {
  // Checked against `audiocpp_cli --help`: "--backend cpu|cuda|hip|rocm|vulkan|metal|best".
  // An unaccepted value would not be caught anywhere else — it becomes a CLI error per segment.
  const accepted = new Set(['cpu', 'cuda', 'hip', 'rocm', 'vulkan', 'metal', 'best']);
  for (const backend of AUDIOCPP_BACKENDS) {
    assert.ok(accepted.has(backend), `${backend} is not a backend audiocpp_cli accepts`);
  }
});

test('a voice that looks like a file becomes a cloning reference, not a voice id', () => {
  assert.ok(looksLikeVoiceReference('assets/sample.wav'));
  assert.ok(looksLikeVoiceReference('/home/me/voice.mp3'));
  assert.ok(!looksLikeVoiceReference('alba'));
  const cloned = buildAudioCppCliArgs({ ...baseCliParams, voice: '/voices/host.wav' });
  assert.ok(cloned.includes('--voice-ref'));
  assert.ok(!cloned.includes('--voice-id'));
});

test('an empty voice means "the family decides" — no flag at all', () => {
  const args = buildAudioCppCliArgs({ ...baseCliParams, voice: '  ' });
  assert.ok(!args.includes('--voice-id'));
  assert.ok(!args.includes('--voice-ref'));
});

test('device, threads and load options only appear when set', () => {
  const bare = buildAudioCppCliArgs(baseCliParams);
  assert.ok(!bare.includes('--device'));
  assert.ok(!bare.includes('--threads'));
  assert.ok(!bare.includes('--load-option'));
  const full = buildAudioCppCliArgs({
    ...baseCliParams,
    device: 1,
    threads: 8,
    loadOptions: ['language=chinese', ' ', 'temperature=0.7'],
  });
  assert.equal(full[full.indexOf('--device') + 1], '1');
  assert.equal(full[full.indexOf('--threads') + 1], '8');
  assert.deepEqual(
    full.filter((_, i) => full[i - 1] === '--load-option'),
    ['language=chinese', 'temperature=0.7'],
  );
});

test('device 0 is a real GPU ordinal, not "unset"', () => {
  const args = buildAudioCppCliArgs({ ...baseCliParams, device: 0 });
  assert.equal(args[args.indexOf('--device') + 1], '0');
});

// --- Server mode -------------------------------------------------------------------------

test('the server body is OpenAI-shaped and asks for WAV, never headerless PCM', () => {
  // Families differ in sample rate (24 kHz vs 48 kHz); a guessed rate does not error, it just
  // plays at the wrong pitch. WAV carries the rate with it.
  assert.deepEqual(buildAudioCppSpeechBody({ model: 'pocket-tts', text: 'hi', voice: 'alba' }), {
    model: 'pocket-tts',
    input: 'hi',
    voice: 'alba',
    response_format: 'wav',
  });
});

test('an empty voice is omitted from the body rather than sent blank', () => {
  const body = buildAudioCppSpeechBody({ model: 'pocket-tts', text: 'hi', voice: '   ' });
  assert.ok(!('voice' in body));
});

test('the speech URL tolerates a trailing slash on the base URL', () => {
  assert.equal(audioCppSpeechUrl('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080/v1/audio/speech');
  assert.equal(audioCppSpeechUrl('http://127.0.0.1:8080/v1//'), 'http://127.0.0.1:8080/v1/audio/speech');
});

test('mode "auto" follows whether a server address was configured', () => {
  const settings = (over: Partial<AudioCppSettings>): AudioCppSettings => ({
    mode: 'auto',
    baseUrl: '',
    binPath: 'audiocpp_cli',
    model: '/models/x',
    family: 'pocket_tts',
    backend: 'auto',
    ...over,
  });
  assert.equal(effectiveAudioCppMode(settings({})), 'cli');
  assert.equal(effectiveAudioCppMode(settings({ baseUrl: 'http://127.0.0.1:8080/v1' })), 'server');
  // An explicit choice wins over the inference either way.
  assert.equal(effectiveAudioCppMode(settings({ mode: 'cli', baseUrl: 'http://x/v1' })), 'cli');
  assert.equal(effectiveAudioCppMode(settings({ mode: 'server' })), 'server');
});

// --- GPU → CPU fallback ------------------------------------------------------------------

test('only hardware-shaped failures are worth retrying on the CPU', () => {
  assert.ok(isBackendUnavailableError('CUDA error: no CUDA-capable device is detected'));
  assert.ok(isBackendUnavailableError('failed to init Metal device'));
  assert.ok(isBackendUnavailableError('ggml was not compiled with vulkan support'));
  // A bad model path or malformed input fails identically on the CPU, so a retry would only
  // burn minutes of local compute before reporting the same thing.
  assert.ok(!isBackendUnavailableError('failed to open model file: no such file or directory'));
  assert.ok(!isBackendUnavailableError(''));
});

// --- Voice namespaces --------------------------------------------------------------------

test('a leftover hosted voice name is not passed to a local model', () => {
  // The deck-level fallback often still holds the voice of whichever provider made the deck.
  // 'alloy' means nothing to a local family: it either errors or picks something arbitrary.
  assert.ok(!isAudioCppVoiceUsable('alloy'));
  assert.ok(!isAudioCppVoiceUsable('Kore'));
  assert.ok(isAudioCppVoiceUsable('alba'));
  assert.ok(isAudioCppVoiceUsable('/voices/host.wav'));
  assert.equal(audioCppVoiceOrEmpty('Kore'), '');
  assert.equal(audioCppVoiceOrEmpty('alba'), 'alba');
  assert.equal(audioCppVoiceOrEmpty(null), '');
});

test('audio.cpp speaker voices and personas come from its own settings, never inherited', () => {
  // Unlike OpenRouter (whose voices really are Gemini's), nothing about a Gemini/OpenAI name is
  // meaningful to a local family, so inheriting would produce silent nonsense.
  const settings = {
    geminiTtsSpeaker1Voice: 'Puck',
    geminiTtsSpeaker2Voice: 'Kore',
    openaiTtsSpeaker1Voice: 'alloy',
    openaiTtsSpeaker2Voice: 'sage',
    openrouterTtsSpeaker1Voice: '',
    openrouterTtsSpeaker2Voice: '',
    audiocppTtsSpeaker1Voice: 'alba',
    audiocppTtsSpeaker2Voice: '',
  };
  assert.deepEqual(globalSpeakerVoicesFor('audiocpp', settings), {
    speaker1Voice: 'alba',
    speaker2Voice: '',
  });
  const personas = {
    geminiTtsSpeaker1: 'gemini-1',
    geminiTtsSpeaker2: 'gemini-2',
    openaiTtsSpeaker1: 'openai-1',
    openaiTtsSpeaker2: 'openai-2',
    openrouterTtsSpeaker1: '',
    openrouterTtsSpeaker2: '',
    audiocppTtsSpeaker1: 'local-1',
    audiocppTtsSpeaker2: '',
  };
  assert.deepEqual(speakerPersonasFor('audiocpp', personas), {
    speaker1Persona: 'local-1',
    speaker2Persona: '',
  });
});

// --- No key, no cost ---------------------------------------------------------------------

test('a local engine is available without any API key', () => {
  assert.ok(isKeylessProvider('audiocpp'));
  const emptySettings = { openaiApiKey: '', geminiApiKey: '', cguAirApiKey: '', openrouterApiKey: '' } as never;
  // Judged by the ordinary rule, the one provider that always works would look like the broken
  // one and the whole TTS feature would be switched off.
  assert.equal(hasProviderKey(emptySettings, 'audiocpp'), true);
  assert.equal(hasProviderKey(emptySettings, 'openai'), false);
});

test('local synthesis costs nothing, so it never eats the shared weekly quota', () => {
  assert.equal(estimateTtsCostUsd('audiocpp', 'audiocpp:pocket_tts', 1_000_000), 0);
  assert.ok(estimateTtsCostUsd('openai', 'tts-1', 1_000_000) > 0);
});

// --- Model label -------------------------------------------------------------------------

test('each provider is filed under the model that actually produced the page', () => {
  const runtime = {
    geminiTtsModel: 'gemini-2.5-flash-preview-tts',
    openaiTtsModel: 'gpt-4o-mini-tts',
    openrouterTtsModel: 'google/gemini-2.5-flash-preview-tts',
    audiocppTtsModel: '/models/pocket-tts',
    audiocppTtsFamily: 'pocket_tts',
  };
  assert.equal(ttsModelLabelFor('gemini', runtime), 'gemini-2.5-flash-preview-tts');
  assert.equal(ttsModelLabelFor('openai', runtime), 'gpt-4o-mini-tts');
  // Used to be recorded as the OpenAI model, i.e. a model that was never contacted.
  assert.equal(ttsModelLabelFor('openrouter', runtime), 'google/gemini-2.5-flash-preview-tts');
  assert.equal(ttsModelLabelFor('audiocpp', runtime), 'audiocpp:pocket_tts /models/pocket-tts');
});

// --- Speed, applied downstream -----------------------------------------------------------

test('atempo covers the whole speed range the settings allow', () => {
  assert.equal(buildAtempoFilter(1), null);
  assert.equal(buildAtempoFilter(null), null);
  assert.equal(buildAtempoFilter(1.25), 'atempo=1.25');
  assert.equal(buildAtempoFilter(0.75), 'atempo=0.75');
  // A single atempo only accepts 0.5–2.0, so the extremes have to be chained.
  assert.equal(buildAtempoFilter(3), 'atempo=2.0,atempo=1.5');
  assert.equal(buildAtempoFilter(0.25), 'atempo=0.5,atempo=0.5');
});

test('speed is baked in by ffmpeg only when a tempo is asked for', () => {
  // audio.cpp takes no usable speed parameter; without this the deck's speed setting would be
  // silently ignored on that provider — and applied twice on the others.
  const plain = buildSegmentLoudnessConcatArgs(['/tmp/a.wav'], '/tmp/out.m4a');
  assert.ok(!plain.join(' ').includes('atempo'));
  const sped = buildSegmentLoudnessConcatArgs(['/tmp/a.wav'], '/tmp/out.m4a', { tempo: 1.5 });
  assert.ok(sped.join(' ').includes('atempo=1.5'));
  // Loudness normalization must still be there, and still per segment.
  const two = buildSegmentLoudnessConcatArgs(['/tmp/a.wav', '/tmp/b.wav'], '/tmp/out.m4a', { tempo: 1.5 });
  const filter = two[two.indexOf('-filter_complex') + 1]!;
  assert.equal(filter.match(/loudnorm/g)?.length, 2);
  assert.equal(filter.match(/atempo=1\.5/g)?.length, 2);
});

test('a tempo of exactly 1 leaves the filter chain identical to no tempo at all', () => {
  assert.deepEqual(
    buildSegmentLoudnessConcatArgs(['/tmp/a.wav'], '/tmp/out.m4a', { tempo: 1 }),
    buildSegmentLoudnessConcatArgs(['/tmp/a.wav'], '/tmp/out.m4a'),
  );
});
