import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

import { config } from '../src/config';
import {
  VOICE_REF_MAX_SECONDS,
  VoiceRefError,
  audioCppVoiceRefDir,
  readVoiceRefTranscript,
  saveAudioCppVoiceRef,
  voiceRefFileName,
  voiceRefTranscriptPath,
  writeVoiceRefTranscript,
} from '../src/services/audiocppVoiceRef';

// Uploaded reference clips are model input, not user files: audio.cpp opens them later, from
// another process, and a format it cannot read fails once per segment for a whole deck. So the
// upload path re-encodes rather than stores, and these tests check the actual bytes on disk.

const ACCOUNT = 'test-voice-ref-account';

function cleanup(): void {
  fs.rmSync(path.join(config.accountsDir, ACCOUNT), { recursive: true, force: true });
}

/** A real audio file to upload, made with the same ffmpeg the service uses. */
function makeToneFile(seconds: number, format: 'mp3' | 'wav'): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceref-fixture-'));
  const out = path.join(dir, `tone.${format}`);
  const result = spawnSync(ffmpegStatic ?? 'ffmpeg', [
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-ac', '2', '-ar', '44100', '-y', out,
  ], { stdio: 'ignore' });
  assert.equal(result.status, 0, 'fixture ffmpeg run failed');
  const buffer = fs.readFileSync(out);
  fs.rmSync(dir, { recursive: true, force: true });
  return buffer;
}

/** (sampleRate, channels) straight out of the WAV header. */
function wavFormat(file: string): { sampleRate: number; channels: number; bitsPerSample: number } {
  const head = fs.readFileSync(file).subarray(0, 44);
  assert.equal(head.toString('ascii', 0, 4), 'RIFF');
  assert.equal(head.toString('ascii', 8, 12), 'WAVE');
  return {
    channels: head.readUInt16LE(22),
    sampleRate: head.readUInt32LE(24),
    bitsPerSample: head.readUInt16LE(34),
  };
}

test('an uploaded clip is re-encoded to what the model expects, not stored as sent', async (t) => {
  t.after(cleanup);
  const saved = await saveAudioCppVoiceRef({
    accountId: ACCOUNT,
    buffer: makeToneFile(3, 'mp3'),
    filename: 'My Recording.mp3',
  });
  assert.ok(fs.existsSync(saved.path));
  assert.equal(path.extname(saved.path), '.wav', 'the engine is handed a WAV whatever went up');
  // 24 kHz mono matches what the Qwen3 packages generate, so reference and output agree.
  assert.deepEqual(wavFormat(saved.path), { sampleRate: 24_000, channels: 1, bitsPerSample: 16 });
  assert.ok(Math.abs(saved.seconds - 3) < 0.2, `expected ~3s, got ${saved.seconds}`);
});

test('the clip lands under the uploading account, where the engine can still find it later', async (t) => {
  t.after(cleanup);
  const saved = await saveAudioCppVoiceRef({ accountId: ACCOUNT, buffer: makeToneFile(1, 'wav'), filename: 'a.wav' });
  assert.equal(path.dirname(saved.path), audioCppVoiceRefDir(ACCOUNT));
  assert.ok(path.isAbsolute(saved.path), 'the settings field stores this path verbatim');
});

test('an over-long upload is trimmed instead of being paid for on every segment', async (t) => {
  t.after(cleanup);
  const saved = await saveAudioCppVoiceRef({
    accountId: ACCOUNT,
    buffer: makeToneFile(VOICE_REF_MAX_SECONDS + 15, 'wav'),
    filename: 'long.wav',
  });
  assert.ok(
    saved.seconds <= VOICE_REF_MAX_SECONDS + 0.5,
    `expected a trim to ${VOICE_REF_MAX_SECONDS}s, got ${saved.seconds}`,
  );
});

test('something that is not audio is rejected as a bad request, not a crash', async (t) => {
  t.after(cleanup);
  await assert.rejects(
    () => saveAudioCppVoiceRef({ accountId: ACCOUNT, buffer: Buffer.from('not audio at all'), filename: 'x.wav' }),
    (err: unknown) => err instanceof VoiceRefError,
  );
  // A failed conversion must not leave a zero-byte file behind for the engine to open.
  const dir = audioCppVoiceRefDir(ACCOUNT);
  const left = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  assert.deepEqual(left, []);
});

test('an empty upload is refused before ffmpeg is spawned', async (t) => {
  t.after(cleanup);
  await assert.rejects(
    () => saveAudioCppVoiceRef({ accountId: ACCOUNT, buffer: Buffer.alloc(0), filename: 'x.wav' }),
    (err: unknown) => err instanceof VoiceRefError,
  );
});

test('the transcript rides with the clip, not with the speaker slot', async (t) => {
  t.after(cleanup);
  const saved = await saveAudioCppVoiceRef({ accountId: ACCOUNT, buffer: makeToneFile(1, 'wav'), filename: 'a.wav' });
  // Qwen3 cloning refuses to run without it, and pointing both speakers at one clip should not
  // mean typing the same sentence twice — so it lives beside the audio, not in a settings field.
  assert.equal(readVoiceRefTranscript(saved.path), '', 'a fresh clip has no transcript yet');
  await writeVoiceRefTranscript(saved.path, '  大家好，這是一段測試錄音。  ');
  assert.equal(readVoiceRefTranscript(saved.path), '大家好，這是一段測試錄音。');
  assert.equal(voiceRefTranscriptPath(saved.path), `${saved.path}.txt`);
  // A path with no sidecar reads as empty rather than throwing: the caller turns that into the
  // "please add a transcript" error, and a user-typed path legitimately has none.
  assert.equal(readVoiceRefTranscript('/nowhere/at/all.wav'), '');
});

test('the stored name stays readable without trusting what the browser sent', () => {
  // The full path shows up in the settings field, so the original stem is worth keeping — but only
  // after it stops being able to say anything about directories.
  const name = voiceRefFileName('主持人 錄音.m4a');
  assert.match(name, /\.wav$/);
  assert.ok(!name.includes('/') && !name.includes('\\') && !name.includes('..'));
  assert.ok(name.includes('主持人'), 'a recognisable stem is the point of keeping it at all');
  const traversal = voiceRefFileName('../../etc/passwd');
  assert.equal(path.basename(traversal), traversal, 'a traversal attempt must not survive as a path');
  // Two uploads of the same name must not overwrite each other — one of them is in use.
  assert.notEqual(voiceRefFileName('a.wav'), voiceRefFileName('a.wav'));
  // A name with nothing usable left still produces a filename.
  assert.match(voiceRefFileName('###.wav'), /^voice-[0-9a-f]{8}\.wav$/);
  assert.match(voiceRefFileName(''), /^voice-[0-9a-f]{8}\.wav$/);
});
