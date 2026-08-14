import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  AUDIOCPP_BACKENDS,
  AUDIOCPP_VOICE_DESIGN,
  audioCppLanguageFor,
  shouldSimplifyForAudioCpp,
  simplifyChineseForModel,
  audioCppModelPathForMode,
  audioCppSpeechUrl,
  audioCppSupportsInstruct,
  audioCppTaskFor,
  audioCppVoiceFlag,
  audioCppVoiceMode,
  audioCppVoiceOrEmpty,
  audioCppEffectiveVoice,
  AUDIOCPP_QWEN3_FALLBACK_SPEAKER,
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

test('the voice field answers three questions, and the mode tells them apart', () => {
  // Each mode is a different Qwen3 package with a different task; misreading the field is not a
  // style difference, it is the wrong model.
  assert.equal(audioCppVoiceMode('vivian'), 'speaker');
  assert.equal(audioCppVoiceMode(AUDIOCPP_VOICE_DESIGN), 'design');
  assert.equal(audioCppVoiceMode('/accounts/me/voice-refs/host-ab12cd34.wav'), 'reference');
  assert.equal(audioCppVoiceMode(''), 'speaker');
  assert.equal(audioCppTaskFor('design'), 'vdes');
  assert.equal(audioCppTaskFor('speaker'), 'tts');
  assert.equal(audioCppTaskFor('reference'), 'tts');
});

test('the sentinel cannot be mistaken for something a user would type', () => {
  // It shares the field with speaker ids and filesystem paths; a value either of those could take
  // would make one of them unreachable.
  assert.ok(AUDIOCPP_VOICE_DESIGN.startsWith(' '), 'a leading space is what keeps it out of both spaces');
  assert.equal(audioCppVoiceMode('voice-design.wav'), 'reference');
  assert.equal(audioCppVoiceMode('/voices/voice-design'), 'reference');
});

test('picking a voice picks the model package, because they are three separate downloads', () => {
  // CustomVoice cannot clone and Base has no packaged speakers, so the configured path is only
  // right for one of the three modes. They sit side by side under the same models root and differ
  // by one word — which is exactly enough to derive the others instead of asking for two more
  // settings fields nobody would keep in sync.
  const custom = '/m/models/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF';
  assert.equal(audioCppModelPathForMode(custom, 'design'), '/m/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF');
  assert.equal(audioCppModelPathForMode(custom, 'reference'), '/m/models/Qwen3-TTS-12Hz-1.7B-Base-GGUF');
  assert.equal(audioCppModelPathForMode(custom, 'speaker'), custom);
  // Derivation works from whichever package is configured, not just from CustomVoice.
  const base = '/m/models/Qwen3-TTS-12Hz-1.7B-Base-GGUF';
  assert.equal(audioCppModelPathForMode(base, 'speaker'), '/m/models/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF');
  assert.equal(audioCppModelPathForMode(base, 'design'), '/m/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF');
  // Nothing recognisable: null means "keep what was configured" — inventing a sibling path for a
  // family we know nothing about would be worse than leaving it alone.
  assert.equal(audioCppModelPathForMode('/m/models/PocketTTS-GGUF', 'design'), null);
  assert.equal(audioCppModelPathForMode('', 'design'), null);
  // "Base" only as a whole word: a directory that merely contains the letters is not the package.
  assert.equal(audioCppModelPathForMode('/m/models/DataBase-TTS', 'design'), null);
});

test('Voice Design runs a different task and sends no voice at all', () => {
  // vdes is the only task where the instruction *is* the voice. Passing the sentinel on --speaker
  // would hand the model a speaker id that exists in no table.
  const args = buildAudioCppCliArgs({
    ...baseCliParams,
    family: 'qwen3_tts',
    modelPath: '/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF',
    voice: AUDIOCPP_VOICE_DESIGN,
    persona: '沉穩的中年男聲',
  });
  assert.equal(args[args.indexOf('--task') + 1], 'vdes');
  assert.equal(args[args.indexOf('--instruct') + 1], '沉穩的中年男聲');
  assert.ok(!args.includes('--speaker'), 'the sentinel must never be sent as a speaker id');
  assert.ok(!args.includes('--voice-id'));
  assert.ok(!args.includes('--voice-ref'));
  assert.ok(!args.includes(AUDIOCPP_VOICE_DESIGN));
});

test('an uploaded clip stays on --voice-ref and keeps the tts task', () => {
  const args = buildAudioCppCliArgs({
    ...baseCliParams,
    family: 'qwen3_tts',
    voice: '/accounts/me/voice-refs/host-ab12cd34.wav',
  });
  assert.equal(args[args.indexOf('--task') + 1], 'tts');
  assert.equal(args[args.indexOf('--voice-ref') + 1], '/accounts/me/voice-refs/host-ab12cd34.wav');
});

test('a cloned voice carries the clip transcript, which Qwen3 cloning refuses to work without', () => {
  // Upstream documents --reference-text as optional; the real CLI answers
  // "Qwen3 voice clone ICL mode requires reference text" without it, verified on this machine.
  const args = buildAudioCppCliArgs({
    ...baseCliParams,
    family: 'qwen3_tts',
    voice: '/accounts/me/voice-refs/host.wav',
    referenceText: '大家好，這是一段測試錄音。',
  });
  assert.equal(args[args.indexOf('--reference-text') + 1], '大家好，這是一段測試錄音。');
  // It belongs to the clip, so it is only sent alongside one — never with a packaged speaker.
  const speaker = buildAudioCppCliArgs({
    ...baseCliParams,
    family: 'qwen3_tts',
    voice: 'vivian',
    referenceText: '大家好',
  });
  assert.ok(!speaker.includes('--reference-text'));
});

test('the deck language reaches the model, instead of leaving it to guess', () => {
  // The bug this fixes: with no --language a zh-TW deck came back read in Cantonese. Qwen3's
  // vocabulary is English words (`--inspect` reports Auto/chinese/english/french/german/italian/
  // japanese/korean/portuguese/russian/spanish), so the BCP-47 tag has to be translated.
  assert.equal(audioCppLanguageFor({ family: 'qwen3_tts', contentLanguage: 'zh-TW' }), 'chinese');
  assert.equal(audioCppLanguageFor({ family: 'qwen3_tts', contentLanguage: 'en' }), 'english');
  // A family whose language words we do not know gets nothing: values differ per family, and a
  // wrong one is a CLI error on every segment — worse than the guess we are replacing.
  assert.equal(audioCppLanguageFor({ family: 'pocket_tts', contentLanguage: 'zh-TW' }), '');
  assert.equal(audioCppLanguageFor({ family: 'qwen3_tts', contentLanguage: 'fr' }), '');
  // The setting overrides everything verbatim — including handing the choice back with `Auto`.
  assert.equal(audioCppLanguageFor({ family: 'pocket_tts', contentLanguage: 'zh-TW', setting: 'german' }), 'german');
  assert.equal(audioCppLanguageFor({ family: 'qwen3_tts', contentLanguage: 'zh-TW', setting: 'Auto' }), 'Auto');
});

test('the language rides on --language, and an empty one sends no flag at all', () => {
  const args = buildAudioCppCliArgs({ ...baseCliParams, family: 'qwen3_tts', language: 'chinese' });
  assert.equal(args[args.indexOf('--language') + 1], 'chinese');
  assert.ok(!buildAudioCppCliArgs({ ...baseCliParams, language: '' }).includes('--language'));
  assert.ok(!buildAudioCppCliArgs({ ...baseCliParams }).includes('--language'));
});

test('server mode carries the same language, so transports cannot disagree', () => {
  // audiocpp_server reads `language` off the request body (app/server/runtime.cpp). Without this
  // the same deck would be read in a different language depending on which transport is set up.
  const body = buildAudioCppSpeechBody({ model: 'm', text: '嗨', voice: '', family: 'qwen3_tts', language: 'chinese' });
  assert.equal(body.language, 'chinese');
  assert.ok(!('language' in buildAudioCppSpeechBody({ model: 'm', text: '嗨', voice: '', family: 'qwen3_tts' })));
});

test('Traditional text is rewritten for the model only where it changes the accent', () => {
  // Confirmed by ear across two fixed seeds: Qwen3 VoiceDesign reads Traditional Chinese as
  // Cantonese and Simplified as Mandarin. The instruction cannot override it — 「說標準普通話」
  // still came out Cantonese — so the character set is the only lever.
  assert.equal(simplifyChineseForModel('今天我們要談的是系統架構'), '今天我们要谈的是系统架构');
  const chinese = { family: 'qwen3_tts', language: 'chinese' };
  assert.equal(shouldSimplifyForAudioCpp({ ...chinese, mode: 'design' }), true);
  // CustomVoice and cloning are fine with Traditional (verified on this machine), and rewriting
  // text we do not have to is a change to what the model is asked to say.
  assert.equal(shouldSimplifyForAudioCpp({ ...chinese, mode: 'speaker' }), false);
  assert.equal(shouldSimplifyForAudioCpp({ ...chinese, mode: 'reference' }), false);
  // An English deck has nothing to convert, and another family is not known to share the quirk.
  assert.equal(shouldSimplifyForAudioCpp({ family: 'qwen3_tts', language: 'english', mode: 'design' }), false);
  assert.equal(shouldSimplifyForAudioCpp({ family: 'voxcpm2', language: 'chinese', mode: 'design' }), false);
  // Forced either way, because this is a model quirk: the next package may or may not share it.
  assert.equal(shouldSimplifyForAudioCpp({ ...chinese, mode: 'speaker', setting: 'on' }), true);
  assert.equal(shouldSimplifyForAudioCpp({ ...chinese, mode: 'design', setting: 'off' }), false);
});

test('a seed reaches both transports, so a re-narrated page can sound identical', () => {
  // Without one, audio.cpp samples freshly every run: the same page regenerated comes back
  // slightly different. Verified on this machine that a fixed seed reproduces byte for byte.
  const args = buildAudioCppCliArgs({ ...baseCliParams, seed: '1234' });
  assert.equal(args[args.indexOf('--seed') + 1], '1234');
  assert.ok(!buildAudioCppCliArgs({ ...baseCliParams }).includes('--seed'));
  assert.ok(!buildAudioCppCliArgs({ ...baseCliParams, seed: '  ' }).includes('--seed'));
  // The server takes it as a request option, so both transports reproduce the same audio.
  assert.equal(buildAudioCppSpeechBody({ model: 'm', text: '嗨', voice: '', seed: '1234' }).seed, '1234');
  assert.ok(!('seed' in buildAudioCppSpeechBody({ model: 'm', text: '嗨', voice: '' })));
});

test('a built-in voice rides on the flag its family actually reads', () => {
  // Verified against audio.cpp's source: Qwen3-TTS CustomVoice looks the name up in a speaker
  // table fed by `--speaker` (src/models/qwen3_tts/talker.cpp throws "unsupported speaker" when
  // it is absent), while PocketTTS takes `--voice-id`. Sending the wrong one is not a silent
  // downgrade — it fails every segment of the deck.
  assert.equal(audioCppVoiceFlag({ voice: 'Vivian', family: 'qwen3_tts' }), '--speaker');
  assert.equal(audioCppVoiceFlag({ voice: 'alba', family: 'pocket_tts' }), '--voice-id');
  assert.equal(audioCppVoiceFlag({ voice: 'alba', family: '' }), '--voice-id');
  // A path means voice cloning whatever the family is.
  assert.equal(audioCppVoiceFlag({ voice: '/voices/host.wav', family: 'qwen3_tts' }), '--voice-ref');
  assert.equal(audioCppVoiceFlag({ voice: '  ', family: 'qwen3_tts' }), null);
});

test('the voice flag can be forced when a new family maps differently', () => {
  // The family→flag mapping lives in each loader upstream and new families keep appearing;
  // being wrong should cost one env var rather than a release.
  assert.equal(audioCppVoiceFlag({ voice: 'Vivian', family: 'pocket_tts', setting: 'speaker' }), '--speaker');
  assert.equal(audioCppVoiceFlag({ voice: 'alba', family: 'qwen3_tts', setting: 'voice-id' }), '--voice-id');
  assert.equal(audioCppVoiceFlag({ voice: 'alba', family: 'qwen3_tts', setting: 'auto' }), '--speaker');
});

test('the qwen3 speaker flag survives into the actual command line', () => {
  const args = buildAudioCppCliArgs({ ...baseCliParams, family: 'qwen3_tts', voice: 'Vivian' });
  assert.equal(args[args.indexOf('--speaker') + 1], 'Vivian');
  assert.ok(!args.includes('--voice-id'));
});

test('the persona rides on --instruct for families that have one', () => {
  // Measured, not assumed: same text and speaker, 「非常緩慢、低沉、嚴肅地說」 produced 5.84 s of
  // audio where no persona produced 4.00 s. Without this flag the 人設 box would be decorative on
  // the one family that can act on it.
  const args = buildAudioCppCliArgs({ ...baseCliParams, family: 'qwen3_tts', persona: '沉穩、語速偏慢' });
  assert.equal(args[args.indexOf('--instruct') + 1], '沉穩、語速偏慢');
});

test('a family with no instruction field never sees the persona', () => {
  // PocketTTS and friends are acoustic models: an unknown flag is a CLI error, and stuffing the
  // persona into the text instead would simply have it read aloud (which is why prompt steering
  // is opt-in).
  assert.ok(audioCppSupportsInstruct('qwen3_tts'));
  assert.ok(!audioCppSupportsInstruct('pocket_tts'));
  assert.ok(!audioCppSupportsInstruct(''));
  const args = buildAudioCppCliArgs({ ...baseCliParams, family: 'pocket_tts', persona: '沉穩、語速偏慢' });
  assert.ok(!args.includes('--instruct'));
});

test('an empty persona adds no flag at all', () => {
  const args = buildAudioCppCliArgs({ ...baseCliParams, family: 'qwen3_tts', persona: '   ' });
  assert.ok(!args.includes('--instruct'));
});

test('the server body carries the persona as `instructions`, and only where it applies', () => {
  const withPersona = buildAudioCppSpeechBody({
    model: 'qwen3',
    text: 'hi',
    voice: 'vivian',
    persona: '沉穩',
    family: 'qwen3_tts',
  });
  assert.equal(withPersona.instructions, '沉穩');
  const other = buildAudioCppSpeechBody({
    model: 'pocket',
    text: 'hi',
    voice: 'alba',
    persona: '沉穩',
    family: 'pocket_tts',
  });
  assert.ok(!('instructions' in other));
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

test('Qwen3-TTS gets a built-in speaker when the fallback chain ends with no voice', () => {
  // CustomVoice has no default speaker: with an empty --speaker it aborts the segment with
  // 'Qwen3 custom voice prefill requires speaker', which names neither the page nor the setting.
  assert.equal(audioCppEffectiveVoice({ voice: '', family: 'qwen3_tts' }), AUDIOCPP_QWEN3_FALLBACK_SPEAKER);
  assert.equal(audioCppEffectiveVoice({ voice: '   ', family: 'qwen3_tts_12hz' }), AUDIOCPP_QWEN3_FALLBACK_SPEAKER);
  // The fallback is a built-in speaker name, so it stays on the CustomVoice package and --speaker.
  assert.equal(audioCppVoiceMode(AUDIOCPP_QWEN3_FALLBACK_SPEAKER), 'speaker');
  assert.equal(
    audioCppVoiceFlag({ voice: AUDIOCPP_QWEN3_FALLBACK_SPEAKER, family: 'qwen3_tts' }),
    '--speaker',
  );
  // A configured voice is never second-guessed, and other families keep meaning "your default".
  assert.equal(audioCppEffectiveVoice({ voice: 'ryan', family: 'qwen3_tts' }), 'ryan');
  assert.equal(audioCppEffectiveVoice({ voice: AUDIOCPP_VOICE_DESIGN, family: 'qwen3_tts' }), AUDIOCPP_VOICE_DESIGN);
  assert.equal(audioCppEffectiveVoice({ voice: '', family: 'pocket_tts' }), '');
  assert.equal(audioCppEffectiveVoice({ voice: '', family: '' }), '');
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

test('the settings preview applies speed the same way a deck does', () => {
  // Found by actually running it: decks bake the speed in with atempo (audio.cpp takes no usable
  // speed parameter), but the preview called the same builder without one — so every audio.cpp
  // preview played at 1.0 while its decks played at the configured speed. That is the very
  // "the preview is not what the deck sounds like" class of bug the preview path exists to avoid.
  const source = fs.readFileSync(
    new URL('../src/services/ttsPreview.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /levelLikeTheDeck\(\s*raw\.audio,\s*raw\.ext,\s*\n?\s*params\.provider === 'audiocpp' \? config\.openaiTtsSpeed : undefined,?\s*\)/);
  assert.match(source, /buildSegmentLoudnessConcatArgs\(\[source\], target, \{ tempo \}\)/);
});

test('a tempo of exactly 1 leaves the filter chain identical to no tempo at all', () => {
  assert.deepEqual(
    buildSegmentLoudnessConcatArgs(['/tmp/a.wav'], '/tmp/out.m4a', { tempo: 1 }),
    buildSegmentLoudnessConcatArgs(['/tmp/a.wav'], '/tmp/out.m4a'),
  );
});
