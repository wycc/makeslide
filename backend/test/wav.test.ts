import test from 'node:test';
import assert from 'node:assert/strict';

import { parseWavPcmChunk, buildWavPcm16 } from '../src/services/wav';

test('buildWavPcm16 then parseWavPcmChunk round-trips the PCM data and format', () => {
  const pcm = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
  const wav = buildWavPcm16(pcm, 24000, 1);
  const parsed = parseWavPcmChunk(wav);
  assert.ok(parsed, 'expected a parseable WAV');
  assert.equal(parsed!.sampleRate, 24000);
  assert.equal(parsed!.channels, 1);
  assert.equal(parsed!.bitsPerSample, 16);
  assert.deepEqual([...parsed!.data], [...pcm]);
});

test('buildWavPcm16 writes a 44-byte RIFF/WAVE header with correct sizes', () => {
  const pcm = Buffer.alloc(100);
  const wav = buildWavPcm16(pcm, 48000, 2);
  assert.equal(wav.length, 44 + 100);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(4), 36 + 100); // RIFF chunk size
  assert.equal(wav.readUInt32LE(40), 100); // data chunk size
  assert.equal(wav.readUInt16LE(22), 2); // channels
  assert.equal(wav.readUInt32LE(24), 48000); // sample rate
});

test('parseWavPcmChunk returns null for non-WAV or too-short buffers', () => {
  assert.equal(parseWavPcmChunk(Buffer.alloc(10)), null);
  assert.equal(parseWavPcmChunk(Buffer.alloc(44)), null); // zeroed: no RIFF/WAVE magic
  const notWav = Buffer.alloc(50);
  notWav.write('RIFFxxxxMP3 ', 0, 'ascii');
  assert.equal(parseWavPcmChunk(notWav), null);
});

test('parseWavPcmChunk skips a non-data chunk to find the data chunk', () => {
  // Build a WAV then prepend an extra "LIST" chunk after fmt to exercise chunk walking.
  const pcm = Buffer.from([9, 9, 9, 9]);
  const base = buildWavPcm16(pcm, 16000, 1);
  // base layout: [0..36) header up to 'data', [36..40) 'data', [40..44) size, [44..) pcm
  const head = base.subarray(0, 36); // RIFF...fmt...(through byteRate/blockAlign/bits)
  const listChunk = Buffer.alloc(8 + 4);
  listChunk.write('LIST', 0, 'ascii');
  listChunk.writeUInt32LE(4, 4);
  listChunk.write('INFO', 8, 'ascii');
  const dataChunk = base.subarray(36); // 'data' + size + pcm
  const withList = Buffer.concat([head, listChunk, dataChunk]);
  // fix RIFF size
  withList.writeUInt32LE(withList.length - 8, 4);
  const parsed = parseWavPcmChunk(withList);
  assert.ok(parsed);
  assert.deepEqual([...parsed!.data], [...pcm]);
});
