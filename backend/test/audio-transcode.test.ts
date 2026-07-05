import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { transcodeToMp3 } from '../src/services/audioTranscode';

const FFMPEG = ffmpegStatic ?? 'ffmpeg';

// Produce a short opus/webm clip like MediaRecorder would (streamed, no duration cues).
async function makeWebm(): Promise<Buffer | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-transcode-test-'));
  const p = path.join(dir, 'a.webm');
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(FFMPEG, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-f', 'webm', '-y', p], { stdio: 'ignore' });
      proc.on('error', reject);
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
    });
    return await fs.readFile(p);
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('transcodeToMp3 converts a MediaRecorder-style webm into a valid, non-empty mp3', async () => {
  const webm = await makeWebm();
  if (!webm) return; // ffmpeg unavailable in this environment — skip
  const mp3 = await transcodeToMp3(webm);
  assert.ok(mp3.length > 0, 'mp3 output should be non-empty');
  // Valid mp3 begins with an ID3 tag or an MPEG frame sync (0xFF 0xEx).
  const isId3 = mp3.subarray(0, 3).toString('latin1') === 'ID3';
  const isFrameSync = mp3[0] === 0xff && (mp3[1]! & 0xe0) === 0xe0;
  assert.ok(isId3 || isFrameSync, 'output should look like an mp3');
});
