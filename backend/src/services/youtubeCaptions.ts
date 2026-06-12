import { getSubtitles } from 'youtube-caption-extractor';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

const FFMPEG = ffmpegStatic ?? 'ffmpeg';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../logger';
import { transcribeAudioBuffer } from './openai';

export interface YoutubeCaptionLine {
  start: number;
  dur: number;
  text: string;
}

export interface YoutubeCaptionResult {
  language: string | null;
  lines: YoutubeCaptionLine[];
  normalizedText: string;
}

const YT_DLP_DOWNLOAD_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

// yt-dlp requires Python >= 3.10. The bundled zipapp's shebang (#!/usr/bin/env
// python3) may resolve to an older interpreter (e.g. Anaconda 3.8), so we run it
// with an explicitly resolved interpreter instead of relying on the shebang.
const PYTHON_CANDIDATES = ['python3.12', 'python3.11', 'python3.10', 'python3'];

let cachedPython: string | null | undefined;
async function resolvePython(): Promise<string | null> {
  if (cachedPython !== undefined) return cachedPython;
  for (const py of PYTHON_CANDIDATES) {
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(
        py,
        ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'],
        { stdio: 'ignore' },
      );
      p.on('close', (code) => resolve(code === 0));
      p.on('error', () => resolve(false));
    });
    if (ok) {
      cachedPython = py;
      return py;
    }
  }
  cachedPython = null;
  return null;
}

async function canRun(python: string, bin: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const p = spawn(python, [bin, '--version'], { stdio: 'ignore' });
    p.on('close', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

// Run yt-dlp through the resolved Python interpreter and resolve to true on exit
// code 0. stdout/stderr are captured and logged (truncated) for diagnostics.
async function runYtDlp(
  python: string,
  ytDlpBin: string,
  cmdArgs: string[],
  videoId: string,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    // Recent yt-dlp needs a JavaScript runtime to solve YouTube's player
    // challenges; without one extraction fails with "This video is not
    // available". Point it at the same Node binary running this backend.
    const spawnArgs = [ytDlpBin, '--js-runtimes', `node:${process.execPath}`, ...cmdArgs];
    const cmdline = `${python} ${spawnArgs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
    logger.info({ videoId, command: cmdline }, 'yt-dlp spawn');

    const p = spawn(python, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout?.on('data', (buf) => {
      stdout += String(buf);
    });
    p.stderr?.on('data', (buf) => {
      stderr += String(buf);
    });

    p.on('close', (code, signal) => {
      const outShort = stdout.length > 4000 ? `${stdout.slice(0, 4000)}\n...[truncated]` : stdout;
      const errShort = stderr.length > 4000 ? `${stderr.slice(0, 4000)}\n...[truncated]` : stderr;
      logger.info(
        { videoId, exitCode: code, signal, stdout: outShort, stderr: errShort },
        'yt-dlp finished',
      );
      resolve(code === 0);
    });
    p.on('error', (err) => {
      logger.error({ err, videoId, command: cmdline }, 'yt-dlp spawn error');
      resolve(false);
    });
  });
}

async function runFfmpeg(args: string[], videoId: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr?.on('data', (buf) => {
      stderr += String(buf);
    });
    p.on('close', (code) => {
      if (code !== 0) {
        const errShort = stderr.length > 2000 ? `${stderr.slice(0, 2000)}\n...[truncated]` : stderr;
        logger.warn({ videoId, exitCode: code, stderr: errShort }, 'ffmpeg finished with error');
      }
      resolve(code === 0);
    });
    p.on('error', (err) => {
      logger.error({ err, videoId }, 'ffmpeg spawn error');
      resolve(false);
    });
  });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = https.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Download yt-dlp failed with status ${status}`));
        return;
      }

      const out = fs.createWriteStream(dest, { mode: 0o755 });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', (err) => reject(err));
    });
    req.on('error', reject);
  });
}

async function ensureYtDlpBinary(python: string): Promise<string | null> {
  const workspaceYtDlpPath = path.resolve(process.cwd(), 'yt-dlp');
  const localCandidates = [
    workspaceYtDlpPath,
    path.resolve(process.cwd(), '../yt-dlp'),
  ];

  for (const p of localCandidates) {
    if (await canRun(python, p)) return p;
  }

  const binPath: string = workspaceYtDlpPath;
  try {
    await fs.promises.access(binPath, fs.constants.X_OK);
    return binPath;
  } catch {
    // continue
  }

  try {
    await downloadFile(YT_DLP_DOWNLOAD_URL, binPath);
    await fs.promises.chmod(binPath, 0o755);
    if (await canRun(python, binPath)) return binPath;
  } catch {
    return null;
  }
  return null;
}

async function fetchByYtDlp(videoId: string, language?: string | null): Promise<YoutubeCaptionResult | null> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ms-ytcap-'));
  const base = path.join(tmpDir, 'cap');
  const preferred = (language?.trim() || 'zh-TW');
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const python = await resolvePython();
  if (!python) {
    logger.error({ videoId }, 'no Python >= 3.10 interpreter found for yt-dlp');
    return null;
  }
  const ytDlpBin = await ensureYtDlpBinary(python);
  if (!ytDlpBin) return null;

  const langCandidates = Array.from(
    new Set([preferred, 'zh-TW', 'zh-Hant', 'zh', 'ja', 'en-US', 'en']),
  );

  for (const lang of langCandidates) {
    const args = [
      '--skip-download',
      '--write-auto-subs',
      '--write-subs',
      '--sub-langs', lang,
      '--sub-format', 'vtt',
      '--ignore-errors',
      '-o', `${base}.%(ext)s`,
      url,
    ];

    const ok = await runYtDlp(python, ytDlpBin, args, videoId);
    if (!ok) continue;

    const files = await fs.promises.readdir(tmpDir);
    const vtt = files
      .filter((f) => f.endsWith('.vtt'))
      .sort((a, b) => b.localeCompare(a))[0];
    if (!vtt) continue;

    const raw = await fs.promises.readFile(path.join(tmpDir, vtt), 'utf8');
    const lines = raw
      .split('\n')
      .map((s) => s.trim())
      // Drop VTT structural lines
      .filter((s) => s && !s.startsWith('WEBVTT') && !s.includes('-->') && !/^\d+$/.test(s))
      // Strip inline timing markers emitted by YouTube auto-captions: <00:00:04.095><c>word</c>
      .map((s) => s.replace(/<[^>]+>/g, '').trim())
      .filter((s) => s.length > 0);

    // Deduplicate consecutive identical lines (auto-captions repeat each phrase 2-3×)
    const deduped: string[] = [];
    for (const line of lines) {
      if (deduped[deduped.length - 1] !== line) deduped.push(line);
    }

    const normalized = deduped.join('\n').trim();
    if (!normalized) continue;

    return {
      language: lang,
      lines: deduped.map((t, i) => ({ start: i, dur: 0, text: t })),
      normalizedText: normalized,
    };
  }
  return null;
}

// OpenAI's transcription endpoint caps uploads at 25 MB. We download a low
// bitrate mono mp3 and split it into time-based chunks so even long videos stay
// comfortably under the limit (48 kbps mono ≈ 7 MB / 20 min).
const STT_CHUNK_SECONDS = 20 * 60;

// Fallback when no subtitle track is available at all: download the audio with
// yt-dlp and transcribe it with OpenAI speech-to-text. Returns null (rather than
// throwing) so the caller can fall through to a NO_CAPTION_AVAILABLE error.
async function transcribeByStt(
  videoId: string,
  language?: string | null,
  onProgress?: (step: YoutubeProgressStep) => void,
  audioSavePath?: string,
): Promise<YoutubeCaptionResult | null> {
  const python = await resolvePython();
  if (!python) {
    logger.error({ videoId }, 'no Python >= 3.10 interpreter found for yt-dlp (STT fallback)');
    return null;
  }
  const ytDlpBin = await ensureYtDlpBinary(python);
  if (!ytDlpBin) return null;

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ms-ytstt-'));
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    logger.info({ videoId }, 'youtube STT fallback: downloading audio');
    const downloaded = await runYtDlp(
      python,
      ytDlpBin,
      [
        '-x',
        '--audio-format', 'mp3',
        // Downmix to mono 16 kHz at a low bitrate — plenty for speech and keeps
        // chunks small enough for the transcription endpoint.
        '--ffmpeg-location', FFMPEG,
        '--postprocessor-args', 'ffmpeg:-ac 1 -ar 16000 -b:a 48k',
        '--ignore-errors',
        '-o', path.join(tmpDir, 'audio.%(ext)s'),
        url,
      ],
      videoId,
    );
    if (!downloaded) return null;

    const mp3 = (await fs.promises.readdir(tmpDir)).find((f) => f.endsWith('.mp3'));
    if (!mp3) {
      logger.warn({ videoId }, 'youtube STT fallback: no audio file produced');
      return null;
    }
    const audioPath = path.join(tmpDir, mp3);

    // Persist the downloaded audio so it can be reviewed as a source later —
    // do this before segmenting/cleanup removes the temp directory.
    if (audioSavePath) {
      try {
        await fs.promises.copyFile(audioPath, audioSavePath);
      } catch (err) {
        logger.warn({ err, videoId }, 'youtube STT fallback: failed to persist source audio');
      }
    }

    // Split into chunks; mp3 frames are self-contained so a stream copy is safe.
    const segmented = await runFfmpeg(
      [
        '-i', audioPath,
        '-f', 'segment',
        '-segment_time', String(STT_CHUNK_SECONDS),
        '-c', 'copy',
        path.join(tmpDir, 'chunk_%03d.mp3'),
      ],
      videoId,
    );
    let chunkFiles = segmented
      ? (await fs.promises.readdir(tmpDir)).filter((f) => /^chunk_\d+\.mp3$/.test(f)).sort()
      : [];
    if (chunkFiles.length === 0) chunkFiles = [mp3];

    onProgress?.('transcribing_audio');
    const texts: string[] = [];
    for (const chunk of chunkFiles) {
      const buf = await fs.promises.readFile(path.join(tmpDir, chunk));
      if (buf.length === 0) continue;
      try {
        const text = await transcribeAudioBuffer(buf, chunk, 'audio/mpeg');
        if (text) texts.push(text);
      } catch (err) {
        logger.error({ err, videoId, chunk }, 'youtube STT fallback: transcription failed');
        return null;
      }
    }

    const normalized = texts.join('\n').trim();
    if (!normalized) return null;
    const lines = normalized
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    logger.info(
      { videoId, chunks: chunkFiles.length, lines: lines.length },
      'youtube STT fallback: transcription succeeded',
    );
    return {
      language: language ?? null,
      lines: lines.map((t, i) => ({ start: i, dur: 0, text: t })),
      normalizedText: normalized,
    };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function normalizeLineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export type YoutubeProgressStep = 'downloading_captions' | 'downloading_audio' | 'transcribing_audio';

export async function fetchYoutubeCaptions(
  videoId: string,
  language?: string | null,
  onProgress?: (step: YoutubeProgressStep) => void,
  audioSavePath?: string,
): Promise<YoutubeCaptionResult> {
  onProgress?.('downloading_captions');
  const byYtDlp = await fetchByYtDlp(videoId, language);
  if (byYtDlp) return byYtDlp;
  const candidates = Array.from(
    new Set([
      language ?? undefined,
      undefined,
      'zh-TW',
      'zh-Hant',
      'zh',
      'en',
      'ja',
    ]),
  );

  let lastErr: unknown = null;
  for (const lang of candidates) {
    try {
      const raw = await getSubtitles({ videoID: videoId, lang });
      const lines: YoutubeCaptionLine[] = (raw ?? [])
        .map((r) => ({
          start: Number((r as { start?: string | number }).start ?? 0),
          dur: Number((r as { dur?: string | number }).dur ?? 0),
          text: normalizeLineText(String((r as { text?: string }).text ?? '')),
        }))
        .filter((r) => r.text.length > 0);

      if (lines.length === 0) continue;

      return {
        language: lang ?? null,
        lines,
        normalizedText: lines.map((l) => l.text).join('\n'),
      };
    } catch (err) {
      lastErr = err;
    }
  }

  // No subtitle track of any kind — fall back to download + speech-to-text.
  logger.info({ videoId }, 'no caption track available, falling back to download + STT');
  onProgress?.('downloading_audio');
  try {
    const byStt = await transcribeByStt(videoId, language, onProgress, audioSavePath);
    if (byStt) return byStt;
  } catch (err) {
    logger.error({ err, videoId }, 'STT fallback threw');
  }

  if (lastErr instanceof Error) {
    throw new Error(`NO_CAPTION_AVAILABLE: ${lastErr.message}`);
  }
  throw new Error('NO_CAPTION_AVAILABLE');
}
