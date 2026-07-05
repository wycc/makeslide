import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

const FFMPEG = ffmpegStatic ?? 'ffmpeg';
const TRANSCODE_TIMEOUT_MS = 60_000;

/**
 * MediaRecorder 產出的 webm/opus 常缺時長 metadata（streamed、無 cues），送到 Whisper 會回
 * `400 invalid_audio: Unable to determine audio duration`。用 ffmpeg 重新編碼成單聲道 16kHz mp3
 * （語音足夠、體積小、時長明確），讓轉錄端點能正確處理。回傳 mp3 buffer。
 */
export interface TranscodeOptions {
  sampleRate?: number; // 預設 16000（STT 用；播放品質可用 44100）
  bitrate?: string; // 預設 '48k'（STT 用；播放可用 '96k'）
  mono?: boolean; // 預設 true（麥克風多為單聲道）
}

export async function transcodeToMp3(input: Buffer, opts: TranscodeOptions = {}): Promise<Buffer> {
  const { sampleRate = 16000, bitrate = '48k', mono = true } = opts;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-narr-transcode-'));
  const inPath = path.join(dir, 'in.webm');
  const outPath = path.join(dir, 'out.mp3');
  try {
    await fs.writeFile(inPath, input);
    const args = ['-i', inPath];
    if (mono) args.push('-ac', '1');
    args.push('-ar', String(sampleRate), '-b:a', bitrate, '-y', outPath);
    await runFfmpeg(args);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error('ffmpeg transcode timed out'));
    }, TRANSCODE_TIMEOUT_MS);
    p.on('error', (err) => { clearTimeout(timer); reject(err); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code ?? -1}`));
    });
  });
}
