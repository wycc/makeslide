/**
 * Minimal WAV (PCM) helpers used when stitching per-chunk TTS audio: parse the
 * `data` chunk out of a RIFF/WAVE buffer, and wrap raw PCM16 back into a WAV
 * container. Pure (Buffer in/out) so they can be unit tested without the audio
 * pipeline. Previously duplicated in synthesizeAudio.ts and routes/pdfs/shared.ts.
 */

export interface WavPcmChunk {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  data: Buffer;
}

/** Extracts the PCM `data` chunk (and format fields) from a WAV buffer, or null if it isn't a parseable RIFF/WAVE. */
export function parseWavPcmChunk(buf: Buffer): WavPcmChunk | null {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const start = off + 8;
    const end = start + size;
    if (end > buf.length) break;
    if (id === 'data') {
      return { sampleRate, channels, bitsPerSample, data: buf.subarray(start, end) };
    }
    off = end + (size % 2);
  }
  return null;
}

/** Wraps raw 16-bit PCM into a WAV (RIFF/WAVE) buffer with a 44-byte header. */
export function buildWavPcm16(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
