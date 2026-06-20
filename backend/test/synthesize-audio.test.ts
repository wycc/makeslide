import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWavPcm16,
  extractTtsErrorMessage,
  isRetryableTtsError,
  parseWavPcmChunk,
  runCommand,
  splitByToneMarkers,
  splitSpeakerPrefix,
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
