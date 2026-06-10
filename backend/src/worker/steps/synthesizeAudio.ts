import fs from 'node:fs';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

const FFMPEG = ffmpegStatic ?? 'ffmpeg';
import PQueue from 'p-queue';
import { parseFile } from 'music-metadata';
import { APIError } from 'openai';
import { config } from '../../config';
import { logger } from '../../logger';
import { getOpenAIClient } from '../../services/openai';
import { synthesizeGeminiSpeech } from '../../services/gemini';
import { getRuntimeAiSettings } from '../../services/aiSettings';
import { pageAudioPath, pageScriptPath } from '../../services/storage';
import { db, savePageGenerationPrompt } from '../../db';

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function parseWavPcmChunk(buf: Buffer): { sampleRate: number; channels: number; bitsPerSample: number; data: Buffer } | null {
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

function buildWavPcm16(pcm: Buffer, sampleRate: number, channels: number): Buffer {
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

/**
 * OpenAI TTS hard limit on the `input` field (per docs, 4096 characters).
 * We clip conservatively below this to leave room for multibyte escaping.
 */
const TTS_INPUT_MAX_CHARS = 4096;
const TTS_MAX_ATTEMPTS = 10;
const TTS_RETRY_INITIAL_DELAY_MS = 1000;
const TTS_RETRY_MAX_DELAY_MS = 15000;
const TTS_RETRY_FACTOR = 2;
const TONE_MARKER_RE = /\[\[\s*([^\]]+)\s*\]\]/g;
const SPEAKER_PREFIX_RE = /^\s*Speaker\s*([12])\s*[:：]\s*/i;

export interface SynthesizeAudioPageResult {
  pageNumber: number;
  audioPath: string;
  chars: number;
  bytes: number;
  durationSeconds: number | null;
  generatedAt: string;
  startedAt: string;
  endedAt: string;
  latencyMs: number;
  skipped: boolean;
}

export interface SynthesizeAudioResult {
  pages: SynthesizeAudioPageResult[];
  totalChars: number;
}

export interface SynthesizeAudioOptions {
  pdfId: string;
  pageCount: number;
  /** Per-page scripts already produced by the generateScript step. */
  pages: Array<{ pageNumber: number; script: string }>;
  /**
   * Optional progress callback fired after each page completes (including
   * idempotent skips). `done` is 1-based count of pages finished so far.
   * Safe to invoke from within concurrent workers.
   */
  onPage?: (pageNumber: number, done: number, info?: { startedAt: string; endedAt: string; skipped: boolean; audioPath: string; durationSeconds: number | null }) => void;
  voice?: string | null;
  speed?: number | null;
  /**
   * Optional cancellation probe. Invoked before each page's TTS request.
   * If it returns true, that page throws `CANCELLED` immediately. Tasks
   * already in flight still complete; pending ones will see the abort
   * flag and cascade-throw quickly.
   */
  shouldAbort?: () => boolean;
}

async function readAudioDuration(filePath: string): Promise<number | null> {
  try {
    const meta = await parseFile(filePath, { duration: true });
    const d = meta.format?.duration;
    if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
      return d;
    }
    return null;
  } catch (err) {
    logger.warn(
      { filePath, error: err instanceof Error ? err.message : String(err) },
      'synthesizeAudio: failed to read audio duration',
    );
    return null;
  }
}

function isRetryableTtsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string; type?: string; status?: number };
  const name = (e.name ?? '').toLowerCase();
  const type = (e.type ?? '').toLowerCase();
  const message = (e.message ?? '').toLowerCase();
  const status = e.status;

  if (status === 408 || status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (name.includes('timeout') || type.includes('timeout') || message.includes('timed out')) {
    return true;
  }
  if (name.includes('connection') || type.includes('connection')) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitByToneMarkers(script: string): Array<{ instruction: string; text: string }> {
  const out: Array<{ instruction: string; text: string }> = [];
  let currentInstruction = '平穩敘述';
  let lastIdx = 0;
  TONE_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TONE_MARKER_RE.exec(script)) !== null) {
    const seg = script.slice(lastIdx, m.index).trim();
    if (seg) out.push({ instruction: currentInstruction, text: seg });
    currentInstruction = (m[1] ?? '').trim() || '平穩敘述';
    lastIdx = m.index + m[0].length;
  }
  const tail = script.slice(lastIdx).trim();
  if (tail) out.push({ instruction: currentInstruction, text: tail });
  if (out.length === 0 && script.trim()) {
    out.push({ instruction: '平穩敘述', text: script.trim() });
  }
  return out;
}

/**
 * Strip a leading "Speaker 1:" / "Speaker 2:" label from a dual-host segment
 * (OpenAI dual mode) so it isn't read aloud, and report which speaker the
 * segment belongs to so the caller can pick a per-speaker voice.
 */
function splitSpeakerPrefix(text: string): { speaker: '1' | '2' | null; text: string } {
  const m = SPEAKER_PREFIX_RE.exec(text);
  if (!m) return { speaker: null, text };
  return { speaker: m[1] as '1' | '2', text: text.slice(m[0].length).trim() };
}

async function synthesizeOnePage(params: {
  pdfId: string;
  pageNumber: number;
  pageUid: string;
  script: string;
  voice: string;
  speed: number;
  shouldAbort?: () => boolean;
}): Promise<SynthesizeAudioPageResult> {
  const { pdfId, pageNumber, pageUid, script, voice, speed, shouldAbort } = params;
  if (shouldAbort?.()) {
    const err = new Error('CANCELLED');
    (err as Error & { code?: string }).code = 'CANCELLED';
    throw err;
  }
  const absPath = pageAudioPath(pdfId, pageUid);
  const targetPath = absPath.replace(/\.mp3$/i, '.m4a');

  // Always regenerate audio so updated voice/speed settings reliably apply.

  let input = script.trim();
  if (!input) {
    throw new Error(`Page ${pageNumber} has empty script, cannot synthesize`);
  }
  const runtime = getRuntimeAiSettings();
  const provider = runtime.ttsProvider;
  const client = provider === 'openai' ? getOpenAIClient() : null;

  const rawSegments = splitByToneMarkers(input);
  const segments = rawSegments.map((seg) => {
    // OpenAI 雙人模式：腳本以 "Speaker 1: " / "Speaker 2: " 標籤區分講者，
    // 朗讀前需去除標籤並依講者切換對應聲音；Gemini 則保留標籤交給其
    // multiSpeakerVoiceConfig 自行解析。
    let text = seg.text;
    let segVoice = voice;
    if (provider === 'openai') {
      const { speaker, text: stripped } = splitSpeakerPrefix(seg.text);
      text = stripped;
      if (speaker === '1' && runtime.openaiTtsSpeaker1Voice?.trim()) {
        segVoice = runtime.openaiTtsSpeaker1Voice.trim();
      } else if (speaker === '2' && runtime.openaiTtsSpeaker2Voice?.trim()) {
        segVoice = runtime.openaiTtsSpeaker2Voice.trim();
      }
    }
    if (text.length <= TTS_INPUT_MAX_CHARS) return { ...seg, text, voice: segVoice };
    logger.warn(
      {
        pdfId,
        pageNumber,
        originalChars: text.length,
        maxChars: TTS_INPUT_MAX_CHARS,
      },
      'synthesizeAudio: segment exceeds TTS input limit, truncating',
    );
    return {
      ...seg,
      text: text.slice(0, TTS_INPUT_MAX_CHARS),
      voice: segVoice,
    };
  });

  let lastErr: unknown;
  let delayMs = TTS_RETRY_INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= TTS_MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    const startedAtIso = new Date().toISOString();
    try {
      const buffers: Buffer[] = [];
      for (const seg of segments) {
        console.log({ seg });
        logger.info(
          {
            pdfId,
            pageNumber,
            instruction: seg.instruction,
            text: seg.text,
          },
          'synthesizeAudio: tts segment request',
        );
        let b: Buffer;
        if (provider === 'gemini') {
          b = await synthesizeGeminiSpeech({
            model: runtime.geminiTtsModel,
            text: seg.text,
            voiceName: voice,
            speaker1VoiceName: runtime.geminiTtsSpeaker1Voice,
            speaker2VoiceName: runtime.geminiTtsSpeaker2Voice,
          });
        } else {
          const response = await client!.audio.speech.create({
            model: runtime.openaiTtsModel || config.openaiTtsModel,
            voice: seg.voice,
            input: seg.text,
            response_format: config.openaiTtsFormat,
            speed,
          });
          b = Buffer.from(await response.arrayBuffer());
        }
        if (b.byteLength === 0) {
          throw new Error('OpenAI returned empty audio buffer');
        }
        buffers.push(b);
      }
      let buffer: Buffer;
      if (provider === 'gemini') {
        const parsed = buffers.map((b) => parseWavPcmChunk(b));
        const first = parsed.find((p) => p !== null) ?? null;
        if (first && first.bitsPerSample === 16) {
          const pcm = Buffer.concat(
            parsed
              .map((p, idx) => {
                if (!p) return buffers[idx] ?? Buffer.alloc(0);
                return p.data;
              })
              .filter((b) => b.length > 0),
          );
          buffer = buildWavPcm16(pcm, first.sampleRate, first.channels);
        } else {
          buffer = Buffer.concat(buffers);
        }
      } else {
        buffer = Buffer.concat(buffers);
      }
      const tmpInputPath = provider === 'gemini'
        ? `${targetPath}.tmp.wav`
        : `${targetPath}.tmp.mp3`;
      await fs.promises.writeFile(tmpInputPath, buffer);
      try {
        await runCommand(FFMPEG, [
          '-y',
          '-i',
          tmpInputPath,
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          targetPath,
        ]);
      } finally {
        await fs.promises.rm(tmpInputPath, { force: true });
      }

      const latencyMs = Date.now() - startedAt;
      const duration = await readAudioDuration(targetPath);

      logger.info(
        {
          pdfId,
          pageNumber,
          chars: input.length,
          segments: segments.length,
          bytes: buffer.byteLength,
          durationSeconds: duration,
          latencyMs,
          attempt,
          voice,
          speed,
          model: provider === 'gemini' ? runtime.geminiTtsModel : runtime.openaiTtsModel,
        },
        'synthesizeAudio: page done',
      );

      const endedAtIso = new Date().toISOString();
      return {
        pageNumber,
        audioPath: targetPath,
        chars: input.length,
        bytes: buffer.byteLength,
        durationSeconds: duration,
        generatedAt: endedAtIso,
        startedAt: startedAtIso,
        endedAt: endedAtIso,
        latencyMs,
        skipped: false,
      };
    } catch (err) {
      lastErr = err;
      const latencyMs = Date.now() - startedAt;
      const apiErr = err instanceof APIError ? err : null;
      const retryable = isRetryableTtsError(err);
      const hasMore = attempt < TTS_MAX_ATTEMPTS;
      logger.warn(
        {
          pdfId,
          pageNumber,
          attempt,
          retryable,
          latencyMs,
          status: apiErr?.status,
          code: apiErr?.code,
          error: err instanceof Error ? err.message : String(err),
        },
        'synthesizeAudio: attempt failed',
      );

      if (!retryable || !hasMore) {
        break;
      }

      await sleep(delayMs);
      delayMs = Math.min(Math.floor(delayMs * TTS_RETRY_FACTOR), TTS_RETRY_MAX_DELAY_MS);
    }
  }

  logger.error(
    {
      pdfId,
      pageNumber,
      attempts: TTS_MAX_ATTEMPTS,
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
    },
    'synthesizeAudio: page failed after max retries, skipping page',
  );

  return {
    pageNumber,
    audioPath: targetPath,
    chars: input.length,
    bytes: 0,
    durationSeconds: null,
    generatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    latencyMs: 0,
    skipped: true,
  };
}

/**
 * Per-page OpenAI TTS synthesis driven by a small in-process p-queue so we
 * run multiple pages concurrently (bounded by `TTS_CONCURRENCY`).
 *
 * Existing mp3 files are overwritten to ensure latest TTS settings (voice /
 * speed) always take effect.
 *
 * Throws on the first unrecoverable per-page error (after one retry). Callers
 * should mark the PDF as `failed` in that case.
 */
export async function synthesizeAudio(
  opts: SynthesizeAudioOptions,
): Promise<SynthesizeAudioResult> {
  const { pdfId, pageCount, pages, onPage, shouldAbort } = opts;
  const pageUidRows = db
    .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ?`)
    .all(pdfId) as Array<{ page_number: number; page_uid: string }>;
  const pageUidByNumber = new Map(pageUidRows.map((r) => [r.page_number, r.page_uid]));
  const voice = opts.voice?.trim() || config.openaiTtsVoice;
  const speed = opts.speed ?? config.openaiTtsSpeed;
  const runtime = getRuntimeAiSettings();
  const ttsModel = runtime.ttsProvider === 'gemini' ? 'gemini-tts' : (config.openaiTtsModel ?? 'tts-1');

  // Record audio generation parameters for each page (best-effort)
  for (const page of pages) {
    savePageGenerationPrompt(
      pdfId,
      page.pageNumber,
      'audio',
      `provider: ${runtime.ttsProvider}\nvoice: ${voice}\nspeed: ${speed}\nscript:\n${page.script}`,
      ttsModel,
    );
  }

  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);

  const queue = new PQueue({ concurrency: config.ttsConcurrency });
  const results: SynthesizeAudioPageResult[] = new Array(sorted.length);
  let done = 0;
  let cancelled = false;

  await Promise.all(
    sorted.map((page, idx) =>
      queue.add(async () => {
        try {
          const uid = pageUidByNumber.get(page.pageNumber);
          if (!uid) throw new Error(`page_uid not found for page ${page.pageNumber}`);
          const res = await synthesizeOnePage({
            pdfId,
            pageNumber: page.pageNumber,
            pageUid: uid,
            script: page.script,
            voice,
            speed,
            shouldAbort,
          });
          results[idx] = res;
          done += 1;
          onPage?.(page.pageNumber, done, {
            startedAt: res.startedAt,
            endedAt: res.endedAt,
            skipped: res.skipped,
            audioPath: res.audioPath,
            durationSeconds: res.durationSeconds,
          });
        } catch (err) {
          const code = (err as Error & { code?: string }).code;
          if (code === 'CANCELLED') {
            cancelled = true;
          }
        }
      }),
    ),
  );

  if (cancelled) {
    const err = new Error('CANCELLED');
    (err as Error & { code?: string }).code = 'CANCELLED';
    throw err;
  }

  const totalChars = results.reduce((acc, r) => acc + (r.skipped ? 0 : r.chars), 0);
  logger.info(
    {
      pdfId,
      pageCount,
      generated: results.filter((r) => !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      totalChars,
    },
    'synthesizeAudio: all pages complete',
  );

  return { pages: results, totalChars };
}

/**
 * Read persisted script content for every page (falls back to empty string
 * on read failure). Used by the pipeline to feed the TTS step.
 */
export async function readScriptsForTts(
  pdfId: string,
  pageCount: number,
): Promise<Array<{ pageNumber: number; script: string }>> {
  const pageUidRows = db
    .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ? AND page_number <= ? ORDER BY page_number ASC`)
    .all(pdfId, pageCount) as Array<{ page_number: number; page_uid: string }>;
  const out: Array<{ pageNumber: number; script: string }> = [];
  for (const { page_number: n, page_uid: uid } of pageUidRows) {
    const p = pageScriptPath(pdfId, uid);
    try {
      const content = await fs.promises.readFile(p, 'utf8');
      out.push({ pageNumber: n, script: content });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        out.push({ pageNumber: n, script: '' });
      } else {
        throw err;
      }
    }
  }
  return out;
}
