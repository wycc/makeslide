import { getSubtitles } from 'youtube-caption-extractor';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../logger';

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

async function canRun(bin: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const p = spawn(bin, ['--version'], { stdio: 'ignore' });
    p.on('close', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
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

async function ensureYtDlpBinary(): Promise<string | null> {
  const workspaceYtDlpPath = path.resolve(process.cwd(), 'yt-dlp');
  const localCandidates = [
    workspaceYtDlpPath,
    path.resolve(process.cwd(), '../yt-dlp'),
  ];

  for (const p of localCandidates) {
    if (await canRun(p)) return p;
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
    if (await canRun(binPath)) return binPath;
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
  const ytDlpBin = await ensureYtDlpBinary();
  if (!ytDlpBin) return null;

  const langCandidates = Array.from(
    new Set([preferred, 'zh-TW', 'zh-Hant', 'zh', 'ja', 'en-US', 'en']),
  );
  const runYtDlp = async (bin: string, cmdArgs: string[]): Promise<boolean> =>
    await new Promise<boolean>((resolve) => {
      const cmdline = `${bin} ${cmdArgs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
      logger.info({ videoId, command: cmdline }, 'yt-dlp spawn');

      const p = spawn(bin, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
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
          {
            videoId,
            exitCode: code,
            signal,
            stdout: outShort,
            stderr: errShort,
          },
          'yt-dlp finished',
        );
        resolve(code === 0);
      });
      p.on('error', (err) => {
        logger.error({ err, videoId, command: cmdline }, 'yt-dlp spawn error');
        resolve(false);
      });
    });

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

    const ok = await runYtDlp(ytDlpBin, args);
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
      .filter((s) => s && !s.startsWith('WEBVTT') && !s.includes('-->') && !/^\d+$/.test(s));
    const normalized = lines.join('\n').trim();
    if (!normalized) continue;

    return {
      language: lang,
      lines: lines.map((t, i) => ({ start: i, dur: 0, text: t })),
      normalizedText: normalized,
    };
  }
  return null;
}

function normalizeLineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export async function fetchYoutubeCaptions(
  videoId: string,
  language?: string | null,
): Promise<YoutubeCaptionResult> {
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

  if (lastErr instanceof Error) {
    throw new Error(`NO_CAPTION_AVAILABLE: ${lastErr.message}`);
  }
  throw new Error('NO_CAPTION_AVAILABLE');
}
