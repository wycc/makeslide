import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptStyleForTtsProvider } from '../src/worker/steps/generateScript';
import { globalSpeakerVoicesFor, speakerPersonasFor } from '../src/services/aiSettings';
import { isGeminiVoiceName, parseMimeRateAndChannels } from '../src/services/gemini';
import { config } from '../src/config';
import {
  buildAudioPromptRecord,
  buildSegmentLoudnessConcatArgs,
  buildTtsInstructions,
  buildWavPcm16,
  extractTtsErrorMessage,
  isRetryableTtsError,
  parseWavPcmChunk,
  resolveSpeakerVoice,
  runCommand,
  splitByToneMarkers,
  splitSpeakerPrefix,
  stripSpokenToneTags,
  supportsTtsInstructions,
} from '../src/worker/steps/synthesizeAudio';

const NODE = process.execPath;

// ── buildWavPcm16 / parseWavPcmChunk ─────────────────────────────────────

test('buildWavPcm16 produces a WAV buffer that parseWavPcmChunk can round-trip', () => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const wav = buildWavPcm16(pcm, 24000, 1);
  const parsed = parseWavPcmChunk(wav);
  assert.ok(parsed);
  assert.equal(parsed!.sampleRate, 24000);
  assert.equal(parsed!.channels, 1);
  assert.equal(parsed!.bitsPerSample, 16);
  assert.deepEqual(parsed!.data, pcm);
});

test('buildWavPcm16 writes the expected RIFF/WAVE header fields', () => {
  const pcm = Buffer.from([0, 0, 0, 0]);
  const wav = buildWavPcm16(pcm, 16000, 2);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 2); // channels
  assert.equal(wav.readUInt32LE(24), 16000); // sample rate
  assert.equal(wav.readUInt16LE(34), 16); // bits per sample
  assert.equal(wav.readUInt32LE(40), pcm.length); // data chunk size
});

test('parseWavPcmChunk returns null for a buffer shorter than a WAV header', () => {
  assert.equal(parseWavPcmChunk(Buffer.alloc(10)), null);
});

test('parseWavPcmChunk returns null when the RIFF/WAVE magic bytes are missing', () => {
  const notWav = Buffer.alloc(44);
  notWav.write('XXXX', 0, 'ascii');
  notWav.write('YYYY', 8, 'ascii');
  assert.equal(parseWavPcmChunk(notWav), null);
});

// ── isRetryableTtsError ───────────────────────────────────────────────────

test('isRetryableTtsError treats HTTP 408/429 and 5xx as retryable', () => {
  assert.equal(isRetryableTtsError({ status: 408 }), true);
  assert.equal(isRetryableTtsError({ status: 429 }), true);
  assert.equal(isRetryableTtsError({ status: 500 }), true);
  assert.equal(isRetryableTtsError({ status: 503 }), true);
});

test('isRetryableTtsError treats a 4xx error (other than 408/429) as non-retryable', () => {
  assert.equal(isRetryableTtsError({ status: 400 }), false);
  assert.equal(isRetryableTtsError({ status: 401 }), false);
});

test('isRetryableTtsError treats timeout/connection name, type, or message as retryable', () => {
  assert.equal(isRetryableTtsError({ name: 'TimeoutError' }), true);
  assert.equal(isRetryableTtsError({ type: 'connection_error' }), true);
  assert.equal(isRetryableTtsError({ message: 'Request timed out after 30s' }), true);
});

test('isRetryableTtsError needs a numeric .status: a Gemini message-only 500 is retryable only once gemini.ts attaches .status', () => {
  // The shape gemini.ts used to throw for gn8Sh7nHth p6 — HTTP status only in the message text,
  // no numeric field — was misclassified as non-retryable and failed the page on the first attempt.
  assert.equal(isRetryableTtsError(new Error('Gemini TTS failed: HTTP 500 - INTERNAL')), false);
  // With the status attached (as gemini.ts now does), the same transient 500 is retryable.
  assert.equal(
    isRetryableTtsError(Object.assign(new Error('Gemini TTS failed: HTTP 500 - INTERNAL'), { status: 500 })),
    true,
  );
});

test('isRetryableTtsError returns false for non-object, null, or unrecognized errors', () => {
  assert.equal(isRetryableTtsError(null), false);
  assert.equal(isRetryableTtsError('some string error'), false);
  assert.equal(isRetryableTtsError({ message: 'invalid request' }), false);
});

// ── extractTtsErrorMessage ─────────────────────────────────────────────────

test('extractTtsErrorMessage prefixes the message with status and code when both are present', () => {
  const result = extractTtsErrorMessage({ status: 401, code: 'invalid_api_key', message: 'Incorrect API key' });
  assert.equal(result, '401 invalid_api_key: Incorrect API key');
});

test('extractTtsErrorMessage falls back to type when code is absent', () => {
  const result = extractTtsErrorMessage({ status: 500, type: 'server_error', message: 'Internal error' });
  assert.equal(result, '500 server_error: Internal error');
});

test('extractTtsErrorMessage returns the bare message when there is no status/code/type', () => {
  assert.equal(extractTtsErrorMessage({ message: 'Something went wrong' }), 'Something went wrong');
});

test('extractTtsErrorMessage stringifies a non-object error', () => {
  assert.equal(extractTtsErrorMessage('plain string error'), 'plain string error');
  assert.equal(extractTtsErrorMessage(null), 'null');
});

// ── splitByToneMarkers ────────────────────────────────────────────────────

test('splitByToneMarkers returns a single default-instruction segment when there are no markers', () => {
  const result = splitByToneMarkers('Hello world, this is plain narration.');
  assert.deepEqual(result, [{ instruction: '平穩敘述', text: 'Hello world, this is plain narration.' }]);
});

test('splitByToneMarkers splits on tone markers and tracks the active instruction per segment', () => {
  const script = '[[興奮地]]今天是大日子！[[平靜地]]讓我們開始吧。';
  const result = splitByToneMarkers(script);
  assert.deepEqual(result, [
    { instruction: '興奮地', text: '今天是大日子！' },
    { instruction: '平靜地', text: '讓我們開始吧。' },
  ]);
});

test('splitByToneMarkers returns an empty array for blank/whitespace-only input', () => {
  assert.deepEqual(splitByToneMarkers(''), []);
  assert.deepEqual(splitByToneMarkers('   \n  '), []);
});

test('splitByToneMarkers is safe to call repeatedly (shared module-level regex state)', () => {
  const script = '[[a]]one[[b]]two';
  const first = splitByToneMarkers(script);
  const second = splitByToneMarkers(script);
  assert.deepEqual(first, second);
});

// ── splitSpeakerPrefix ────────────────────────────────────────────────────

test('splitSpeakerPrefix extracts a "Speaker 1:" prefix', () => {
  assert.deepEqual(splitSpeakerPrefix('Speaker 1: Hello there'), { speaker: '1', text: 'Hello there' });
});

test('splitSpeakerPrefix extracts a "Speaker 2：" prefix with a full-width colon', () => {
  assert.deepEqual(splitSpeakerPrefix('Speaker 2：你好'), { speaker: '2', text: '你好' });
});

test('splitSpeakerPrefix is case-insensitive', () => {
  assert.deepEqual(splitSpeakerPrefix('speaker 1: hi'), { speaker: '1', text: 'hi' });
});

test('splitSpeakerPrefix returns the original text unchanged when there is no speaker prefix', () => {
  assert.deepEqual(splitSpeakerPrefix('No prefix here'), { speaker: null, text: 'No prefix here' });
});

// ── stripSpokenToneTags ─────────────────────────────────────────────────────

test('stripSpokenToneTags removes single-bracket English tone tags from spoken text', () => {
  assert.equal(
    stripSpokenToneTags('[cheerfully] 大家好，[seriously] 我們先看重點。'),
    '大家好， 我們先看重點。',
  );
});

test('stripSpokenToneTags removes multi-word English tags like [very fast]', () => {
  assert.equal(stripSpokenToneTags('[very fast] 快速帶過這段。'), '快速帶過這段。');
});

test('stripSpokenToneTags still removes legacy {{...}} emotion notes', () => {
  assert.equal(stripSpokenToneTags('{{興奮}}開場白。'), '開場白。');
});

test('stripSpokenToneTags leaves double-bracket [[ 中文語氣 ]] markers for splitByToneMarkers', () => {
  assert.equal(stripSpokenToneTags('[[ 平穩敘述 ]]這是一段旁白。'), '[[ 平穩敘述 ]]這是一段旁白。');
});

test('stripSpokenToneTags does not touch numeric citations like [1]', () => {
  assert.equal(stripSpokenToneTags('根據研究[1]的結論。'), '根據研究[1]的結論。');
});

test('stripSpokenToneTags collapses the spaces left behind and trims', () => {
  assert.equal(stripSpokenToneTags('  [seriously]   重點  '), '重點');
});

// ── runCommand ────────────────────────────────────────────────────────────

test('runCommand resolves when the process exits 0', async () => {
  await assert.doesNotReject(() => runCommand(NODE, ['-e', 'process.exit(0)']));
});

test('runCommand rejects with the exit code and stderr when the process fails', async () => {
  await assert.rejects(
    () => runCommand(NODE, ['-e', 'process.stderr.write("boom"); process.exit(2)']),
    /exited with code 2: boom/,
  );
});

test('runCommand without a timeoutMs does not kill a slow-but-finishing process early', async () => {
  await assert.doesNotReject(() => runCommand(NODE, ['-e', 'setTimeout(() => process.exit(0), 50)']));
});

test('runCommand kills a process that exceeds timeoutMs and rejects with a "timed out" message', async () => {
  const start = Date.now();
  // Sleeps far longer than the timeout below; if the kill didn't work this test would hang for 30s.
  await assert.rejects(
    () => runCommand(NODE, ['-e', 'setTimeout(() => {}, 30000)'], 100),
    /timed out after 100ms and was killed/,
  );
  assert.ok(Date.now() - start < 5000, 'expected the timed-out process to be killed promptly');
});

// ── TTS instructions (tone + persona actually reaching the speech request) ────

test('supportsTtsInstructions accepts gpt-* speech models', () => {
  assert.equal(supportsTtsInstructions('gpt-4o-mini-tts'), true);
  assert.equal(supportsTtsInstructions('gpt-4o-mini-tts-2025-12-15'), true);
  assert.equal(supportsTtsInstructions('  GPT-4O-MINI-TTS  '), true);
});

test('supportsTtsInstructions rejects the legacy tts-1 models, which error on the field', () => {
  assert.equal(supportsTtsInstructions('tts-1'), false);
  assert.equal(supportsTtsInstructions('tts-1-hd'), false);
  assert.equal(supportsTtsInstructions(''), false);
});

test('buildTtsInstructions carries both the speaker persona and the segment tone', () => {
  assert.equal(
    buildTtsInstructions({ tone: '活潑開場', persona: '活潑，語速稍快' }),
    '角色設定：活潑，語速稍快\n這一段的語氣：活潑開場',
  );
});

test('buildTtsInstructions works with only one of the two present', () => {
  assert.equal(buildTtsInstructions({ tone: '平穩敘述' }), '這一段的語氣：平穩敘述');
  assert.equal(buildTtsInstructions({ persona: '沉穩' }), '角色設定：沉穩');
});

test('buildTtsInstructions returns undefined when there is nothing to steer', () => {
  assert.equal(buildTtsInstructions({}), undefined);
  assert.equal(buildTtsInstructions({ tone: '   ', persona: null }), undefined);
});

// ── audio prompt record ──────────────────────────────────────────────────

test('buildAudioPromptRecord records the per-speaker voices that override the deck voice', () => {
  const record = buildAudioPromptRecord({
    provider: 'openai',
    voice: 'alloy',
    speed: 1,
    script: 'Speaker 1: 你好',
    speaker1Voice: 'alloy',
    speaker2Voice: 'sage',
    speaker1Persona: '沉穩',
    speaker2Persona: '活潑，語速稍快',
  });
  assert.equal(
    record,
    'provider: openai\nvoice: alloy\nspeed: 1\n' +
      'speaker1: voice=alloy persona=沉穩\n' +
      'speaker2: voice=sage persona=活潑，語速稍快\n' +
      'script:\nSpeaker 1: 你好',
  );
});

test('buildAudioPromptRecord omits speaker lines that are not configured', () => {
  assert.equal(
    buildAudioPromptRecord({ provider: 'gemini', voice: 'Puck', speed: 1.1, script: '哈囉' }),
    'provider: gemini\nvoice: Puck\nspeed: 1.1\nscript:\n哈囉',
  );
});

test('buildAudioPromptRecord keeps a speaker line that has only a voice or only a persona', () => {
  const record = buildAudioPromptRecord({
    provider: 'openai',
    voice: 'alloy',
    speed: 1,
    script: 'x',
    speaker2Voice: 'sage',
    speaker1Persona: '沉穩',
  });
  assert.match(record, /^speaker1: persona=沉穩$/m);
  assert.match(record, /^speaker2: voice=sage$/m);
});

// ── per-segment loudness levelling ───────────────────────────────────────

test('buildSegmentLoudnessConcatArgs normalizes each segment before concatenating them', () => {
  const args = buildSegmentLoudnessConcatArgs(['/tmp/a.mp3', '/tmp/b.mp3'], '/tmp/out.m4a');
  assert.deepEqual(args.slice(0, 5), ['-y', '-i', '/tmp/a.mp3', '-i', '/tmp/b.mp3']);
  const filter = args[args.indexOf('-filter_complex') + 1]!;
  // Every input gets its own loudnorm before the concat — a single pass over the joined
  // page would keep one speaker quieter than the other.
  assert.match(filter, /\[0:a\]loudnorm=[^[]+\[s0\];\[1:a\]loudnorm=[^[]+\[s1\]/);
  assert.match(filter, /\[s0\]\[s1\]concat=n=2:v=0:a=1\[out\]/);
  assert.deepEqual(args.slice(-11), [
    '-map', '[out]',
    '-c:a', 'aac',
    '-b:a', '128k',
    // Pinning the rate matters: loudnorm runs at 192 kHz internally and would otherwise
    // leave the encoder writing 96 kHz for 24 kHz speech.
    '-ar', '24000',
    '-movflags', '+faststart',
    '/tmp/out.m4a',
  ]);
});

test('buildSegmentLoudnessConcatArgs uses a plain -af filter for a single segment', () => {
  const args = buildSegmentLoudnessConcatArgs(['/tmp/only.wav'], '/tmp/out.m4a');
  assert.deepEqual(args.slice(0, 3), ['-y', '-i', '/tmp/only.wav']);
  assert.equal(args[3], '-af');
  assert.match(args[4]!, /^loudnorm=/);
  assert.equal(args.includes('-filter_complex'), false);
  assert.equal(args[args.length - 1], '/tmp/out.m4a');
});

test('buildSegmentLoudnessConcatArgs rejects an empty segment list', () => {
  assert.throws(() => buildSegmentLoudnessConcatArgs([], '/tmp/out.m4a'), /at least one input/);
});

// ── per-deck vs global speaker voices ────────────────────────────────────

test('resolveSpeakerVoice: the deck\'s own speaker voice wins over the global one', () => {
  const voice = resolveSpeakerVoice({
    speaker: '2',
    deckVoice: 'alloy',
    deckSpeaker2Voice: 'nova',
    globalSpeaker2Voice: 'sage',
  });
  assert.equal(voice, 'nova');
});

test('resolveSpeakerVoice: leaving the deck voice empty opts back into the global one', () => {
  for (const empty of [undefined, null, '', '   ']) {
    assert.equal(
      resolveSpeakerVoice({
        speaker: '1',
        deckVoice: 'alloy',
        deckSpeaker1Voice: empty,
        globalSpeaker1Voice: 'ash',
      }),
      'ash',
      String(empty),
    );
  }
});

test('resolveSpeakerVoice: with neither configured it falls back to the deck voice', () => {
  assert.equal(resolveSpeakerVoice({ speaker: '1', deckVoice: 'alloy' }), 'alloy');
  assert.equal(
    resolveSpeakerVoice({ speaker: '2', deckVoice: 'alloy', deckSpeaker2Voice: '  ', globalSpeaker2Voice: '' }),
    'alloy',
  );
});

test('resolveSpeakerVoice: a segment with no speaker prefix always uses the deck voice', () => {
  assert.equal(
    resolveSpeakerVoice({
      speaker: null,
      deckVoice: 'alloy',
      deckSpeaker1Voice: 'nova',
      globalSpeaker1Voice: 'sage',
    }),
    'alloy',
  );
});

test('resolveSpeakerVoice: each speaker reads only its own setting', () => {
  const params = {
    deckVoice: 'alloy',
    deckSpeaker1Voice: 'nova',
    deckSpeaker2Voice: 'shimmer',
    globalSpeaker1Voice: 'ash',
    globalSpeaker2Voice: 'sage',
  };
  assert.equal(resolveSpeakerVoice({ speaker: '1', ...params }), 'nova');
  assert.equal(resolveSpeakerVoice({ speaker: '2', ...params }), 'shimmer');
});

test('resolveSpeakerVoice trims the configured value', () => {
  assert.equal(
    resolveSpeakerVoice({ speaker: '1', deckVoice: 'alloy', deckSpeaker1Voice: '  nova  ' }),
    'nova',
  );
});

// ── script format / persona per TTS provider ─────────────────────────────

const RUNTIME_PERSONAS = {
  geminiTtsSpeaker1: 'gemini-1', geminiTtsSpeaker2: 'gemini-2',
  openaiTtsSpeaker1: 'openai-1', openaiTtsSpeaker2: 'openai-2',
  openrouterTtsSpeaker1: 'or-1', openrouterTtsSpeaker2: 'or-2',
};

test('scriptStyleForTtsProvider: openrouter writes OpenAI-format scripts with its own personas', () => {
  // It reaches Gemini TTS through an OpenAI-compatible endpoint and is synthesized segment by
  // segment, so it needs "Speaker N:" labels — not Gemini's inline English tags.
  assert.deepEqual(scriptStyleForTtsProvider('openrouter', RUNTIME_PERSONAS), {
    format: 'openai',
    speaker1Persona: 'or-1',
    speaker2Persona: 'or-2',
  });
});

test('scriptStyleForTtsProvider: openai and gemini keep their own format and personas', () => {
  assert.deepEqual(scriptStyleForTtsProvider('openai', RUNTIME_PERSONAS), {
    format: 'openai', speaker1Persona: 'openai-1', speaker2Persona: 'openai-2',
  });
  assert.deepEqual(scriptStyleForTtsProvider('gemini', RUNTIME_PERSONAS), {
    format: 'gemini', speaker1Persona: 'gemini-1', speaker2Persona: 'gemini-2',
  });
});

// ── global speaker voices per provider ───────────────────────────────────

const VOICE_SETTINGS = {
  geminiTtsSpeaker1Voice: 'Puck', geminiTtsSpeaker2Voice: 'Kore',
  openaiTtsSpeaker1Voice: 'alloy', openaiTtsSpeaker2Voice: 'sage',
  openrouterTtsSpeaker1Voice: 'Charon', openrouterTtsSpeaker2Voice: 'Aoede',
};

test('globalSpeakerVoicesFor: openrouter reads its own voices, not OpenAI\'s', () => {
  // Voice names are not interchangeable between providers, so falling through to the OpenAI
  // pair whenever the provider merely isn't 'gemini' would hand Gemini TTS an OpenAI name.
  assert.deepEqual(globalSpeakerVoicesFor('openrouter', VOICE_SETTINGS), {
    speaker1Voice: 'Charon',
    speaker2Voice: 'Aoede',
  });
});

test('globalSpeakerVoicesFor: openai and gemini keep their own pairs', () => {
  assert.deepEqual(globalSpeakerVoicesFor('openai', VOICE_SETTINGS), {
    speaker1Voice: 'alloy', speaker2Voice: 'sage',
  });
  assert.deepEqual(globalSpeakerVoicesFor('gemini', VOICE_SETTINGS), {
    speaker1Voice: 'Puck', speaker2Voice: 'Kore',
  });
});

// ── openrouter inherits Gemini's speaker settings ────────────────────────
// OpenRouter *is* Gemini TTS behind an OpenAI-compatible endpoint, so a user who configured
// the Gemini pair and switched provider expects those two voices — not both hosts collapsing
// onto one. Its own boxes still win when filled.

const UNSET_OPENROUTER = {
  ...VOICE_SETTINGS,
  openrouterTtsSpeaker1Voice: '', openrouterTtsSpeaker2Voice: '',
};

test('globalSpeakerVoicesFor: openrouter falls back to the Gemini pair when its own is unset', () => {
  assert.deepEqual(globalSpeakerVoicesFor('openrouter', UNSET_OPENROUTER), {
    speaker1Voice: 'Puck',
    speaker2Voice: 'Kore',
  });
});

test('globalSpeakerVoicesFor: openrouter inherits per speaker, not all-or-nothing', () => {
  assert.deepEqual(
    globalSpeakerVoicesFor('openrouter', { ...UNSET_OPENROUTER, openrouterTtsSpeaker2Voice: 'Aoede' }),
    { speaker1Voice: 'Puck', speaker2Voice: 'Aoede' },
  );
});

test('speakerPersonasFor: openrouter inherits Gemini personas only where its own are empty', () => {
  assert.deepEqual(speakerPersonasFor('openrouter', RUNTIME_PERSONAS), {
    speaker1Persona: 'or-1', speaker2Persona: 'or-2',
  });
  assert.deepEqual(
    speakerPersonasFor('openrouter', { ...RUNTIME_PERSONAS, openrouterTtsSpeaker1: '', openrouterTtsSpeaker2: '' }),
    { speaker1Persona: 'gemini-1', speaker2Persona: 'gemini-2' },
  );
  assert.deepEqual(speakerPersonasFor('openai', RUNTIME_PERSONAS), {
    speaker1Persona: 'openai-1', speaker2Persona: 'openai-2',
  });
});

// ── resolveSpeakerVoice skips voices from the wrong namespace ────────────

test('resolveSpeakerVoice: a deck voice from another provider is skipped, not collapsed', () => {
  // The reported bug: a deck configured while the provider was OpenAI keeps 'alloy'/'coral' in
  // its two speaker slots. Those used to win the chain and were then normalized — both to
  // 'Kore' — so a dual-host deck read every line in one voice. They must be skipped so the
  // configured Gemini pair is what actually gets used.
  const common = {
    deckVoice: 'alloy',
    deckSpeaker1Voice: 'alloy',
    deckSpeaker2Voice: 'coral',
    globalSpeaker1Voice: 'Puck',
    globalSpeaker2Voice: 'Kore',
    isVoiceUsable: isGeminiVoiceName,
  } as const;
  assert.equal(resolveSpeakerVoice({ ...common, speaker: '1' }), 'Puck');
  assert.equal(resolveSpeakerVoice({ ...common, speaker: '2' }), 'Kore');
});

test('resolveSpeakerVoice: a usable deck voice still wins over the global one', () => {
  const common = {
    deckVoice: 'Kore',
    deckSpeaker1Voice: 'Charon',
    deckSpeaker2Voice: 'Aoede',
    globalSpeaker1Voice: 'Puck',
    globalSpeaker2Voice: 'Kore',
    isVoiceUsable: isGeminiVoiceName,
  } as const;
  assert.equal(resolveSpeakerVoice({ ...common, speaker: '1' }), 'Charon');
  assert.equal(resolveSpeakerVoice({ ...common, speaker: '2' }), 'Aoede');
});

test('resolveSpeakerVoice: with nothing usable anywhere it still yields the deck voice', () => {
  assert.equal(
    resolveSpeakerVoice({
      speaker: '1',
      deckVoice: 'alloy',
      deckSpeaker1Voice: 'echo',
      globalSpeaker1Voice: 'sage',
      isVoiceUsable: isGeminiVoiceName,
    }),
    'alloy',
  );
});

test('resolveSpeakerVoice: without a gate every non-empty candidate is accepted (OpenAI path)', () => {
  assert.equal(
    resolveSpeakerVoice({ speaker: '1', deckVoice: 'alloy', deckSpeaker1Voice: 'coral' }),
    'coral',
  );
});

// ── openrouter/gemini voice parity ───────────────────────────────────────

test('the OpenRouter and direct-Gemini TTS defaults are the same model generation', () => {
  // A voice name like 'Kore' does not sound the same across TTS model generations, so leaving
  // these on different ones made switching provider audibly change the narrator — even though
  // OpenRouter is reaching the very same Gemini TTS.
  const generation = (model: string) => /(\d+\.\d+)-flash/.exec(model)?.[1] ?? null;
  const openrouter = generation(config.openrouterTtsModel);
  const gemini = generation(config.geminiTtsModel);
  assert.ok(openrouter, `could not read a generation out of ${config.openrouterTtsModel}`);
  assert.equal(openrouter, gemini);
});

test('parseMimeRateAndChannels reads the rate OpenRouter/Gemini report for headerless PCM', () => {
  // Stamping headerless PCM with the wrong rate does not error — it shifts pitch and tempo,
  // which is how "the same voice sounds different" actually reaches the user.
  assert.deepEqual(parseMimeRateAndChannels('audio/L16;codec=pcm;rate=24000'), {
    sampleRate: 24000, channels: 1,
  });
  assert.deepEqual(parseMimeRateAndChannels('audio/L16;rate=48000;channels=2'), {
    sampleRate: 48000, channels: 2,
  });
});

test('parseMimeRateAndChannels falls back to 24 kHz mono when the mime type says nothing', () => {
  assert.deepEqual(parseMimeRateAndChannels('application/octet-stream'), {
    sampleRate: 24000, channels: 1,
  });
  assert.deepEqual(parseMimeRateAndChannels(''), { sampleRate: 24000, channels: 1 });
});

test('a WAV built from a reported rate round-trips that rate, not the assumed one', () => {
  const { sampleRate, channels } = parseMimeRateAndChannels('audio/L16;rate=48000');
  const parsed = parseWavPcmChunk(buildWavPcm16(Buffer.from([1, 2, 3, 4]), sampleRate, channels));
  assert.equal(parsed?.sampleRate, 48000);
});

test('isGeminiVoiceName: accepts Gemini names and rejects OpenAI ones and blanks', () => {
  assert.equal(isGeminiVoiceName('Kore'), true);
  assert.equal(isGeminiVoiceName('  Puck  '), true);
  assert.equal(isGeminiVoiceName('alloy'), false);
  assert.equal(isGeminiVoiceName(''), false);
  assert.equal(isGeminiVoiceName(null), false);
  assert.equal(isGeminiVoiceName(undefined), false);
});
