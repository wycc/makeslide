import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

import { config } from '../config';
import { sanitizeAccountId } from './accountContext';

/**
 * Storage for the reference clips used by audio.cpp voice cloning (`--voice-ref`).
 *
 * The voice field has always accepted a path, but only one the user could already produce on this
 * machine — which on a hosted install is nobody. Uploading closes that gap, and the upload has to
 * land somewhere the engine can open later: a per-account directory next to that account's
 * settings, not a temp file that disappears before the deck is narrated.
 *
 * Everything is re-encoded rather than stored as received. A reference clip is model input, not a
 * user file: audio.cpp wants a WAV it can read, browsers hand us webm/m4a/mp3, and a clip that
 * only fails at synthesis time — once per segment, for the whole deck — is the worst place to
 * discover a format problem.
 */

const FFMPEG = ffmpegStatic ?? 'ffmpeg';
const TRANSCODE_TIMEOUT_MS = 60_000;

/** 24 kHz mono: what the Qwen3-TTS packages generate, so the reference matches the output rate. */
const SAMPLE_RATE = 24_000;

/**
 * Reference clips are trimmed to this. Voice cloning takes its timbre from a few seconds; the rest
 * is prompt tokens the model pays for on every segment, and a whole podcast uploaded by accident
 * would be paid for on every segment of every deck.
 */
export const VOICE_REF_MAX_SECONDS = 30;

/** Where this account's uploaded clips live. */
export function audioCppVoiceRefDir(accountId: string): string {
  return path.join(config.accountsDir, sanitizeAccountId(accountId), 'voice-refs');
}

/**
 * A filename that stays recognisable in the settings field (which shows the full path) without
 * trusting anything the browser sent: the original stem is reduced to safe characters and a random
 * suffix keeps two uploads of `recording.wav` from overwriting each other.
 */
export function voiceRefFileName(originalName: string): string {
  const stem = path.basename(originalName ?? '', path.extname(originalName ?? ''));
  const slug = stem
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'voice'}-${crypto.randomBytes(4).toString('hex')}.wav`;
}

export interface SavedVoiceRef {
  /** Absolute path — this goes straight into the voice field and then into `--voice-ref`. */
  path: string;
  bytes: number;
  seconds: number;
}

/**
 * Where the clip's transcript lives: `<clip>.wav.txt`, beside the audio.
 *
 * Qwen3-TTS Base refuses to clone without one ("Qwen3 voice clone ICL mode requires reference
 * text" — upstream documents `--reference-text` as optional, but its ICL path does not treat it
 * that way), so a clip without a transcript is a clip that cannot be used.
 *
 * A sidecar rather than a settings field because the voice field holds exactly one value — the
 * path — and the transcript belongs to the clip, not to the speaker slot: pointing both speakers
 * at one clip should not need the same sentence typed twice.
 */
export function voiceRefTranscriptPath(clipPath: string): string {
  return `${clipPath}.txt`;
}

export function readVoiceRefTranscript(clipPath: string): string {
  try {
    return fsSync.readFileSync(voiceRefTranscriptPath(clipPath), 'utf8').trim();
  } catch {
    return '';
  }
}

export async function writeVoiceRefTranscript(clipPath: string, transcript: string): Promise<void> {
  await fs.writeFile(voiceRefTranscriptPath(clipPath), `${transcript.trim()}\n`, 'utf8');
}

/** Re-encode an uploaded clip to a mono 24 kHz WAV and keep it under this account. */
export async function saveAudioCppVoiceRef(params: {
  accountId: string;
  buffer: Buffer;
  filename: string;
}): Promise<SavedVoiceRef> {
  if (params.buffer.byteLength === 0) throw new VoiceRefError('上傳的音檔是空的。');
  const dir = audioCppVoiceRefDir(params.accountId);
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, voiceRefFileName(params.filename));
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'makeslide-voiceref-'));
  // Suffix-free: ffmpeg probes the content, and trusting the uploaded extension is how you get a
  // .wav that is actually something else.
  const inPath = path.join(tmpDir, 'input');
  try {
    await fs.writeFile(inPath, params.buffer);
    await runFfmpeg([
      '-i', inPath,
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      '-c:a', 'pcm_s16le',
      '-t', String(VOICE_REF_MAX_SECONDS),
      '-y', outPath,
    ]);
    const stat = await fs.stat(outPath);
    if (stat.size === 0) throw new VoiceRefError('轉檔後的音檔是空的，請換一個檔案。');
    return {
      path: outPath,
      bytes: stat.size,
      // 16-bit mono PCM, so the sample count is the payload size over two, less the 44-byte header.
      seconds: Math.max(0, (stat.size - 44) / 2 / SAMPLE_RATE),
    };
  } catch (err) {
    await fs.rm(outPath, { force: true });
    if (err instanceof VoiceRefError) throw err;
    throw new VoiceRefError('無法讀取這個音檔（支援 wav／mp3／m4a／ogg／flac／webm 等 ffmpeg 認得的格式）。');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * The line a designed voice is frozen with.
 *
 * Long enough to carry timbre (cloning needs a few seconds of speech, and a clip of two words
 * gives the model very little to copy) and phonetically broad — four tones, common finals — so the
 * reference is not a sample of one narrow corner of the voice. Simplified because that is what
 * VoiceDesign has to be fed anyway (see simplifyChineseForModel), and the transcript stored beside
 * the clip has to match what is actually spoken in it.
 */
export const VOICE_FREEZE_TEXT =
  '大家好，欢迎收看今天的简报。接下来我会一页一页说明这份内容的重点，包括系统架构、流程设计，以及最后的效能评估结果。';

/** A problem with the uploaded file itself — the caller turns this into a 400, not a 500. */
export class VoiceRefError extends Error {
  readonly code = 'VOICE_REF_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'VoiceRefError';
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
