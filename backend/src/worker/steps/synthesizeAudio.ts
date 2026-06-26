import fs from 'node:fs';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { parseWavPcmChunk, buildWavPcm16 } from '../../services/wav';

const FFMPEG = ffmpegStatic ?? 'ffmpeg';
// One page's spoken-audio transcode (typically tens of seconds to a few minutes of speech);
// 3 minutes is a generous safety margin over normal runtime.
const AUDIO_TRANSCODE_TIMEOUT_MS = 3 * 60_000;
import PQueue from 'p-queue';
import { parseFile } from 'music-metadata';
import { APIError } from 'openai';
import { config } from '../../config';
import { logger } from '../../logger';
import { getOpenAIClient, transcribeAudioBufferWithWordTimestamps } from '../../services/openai';
import { synthesizeGeminiSpeech } from '../../services/gemini';
import { getRuntimeAiSettings } from '../../services/aiSettings';
import { pageAudioPath, pageScriptPath, pageTimelinePath } from '../../services/storage';
import { alignSentencesToWordTimestamps, splitScriptIntoSentences } from '../../services/subtitleAlignment';
import { db, savePageGenerationPrompt } from '../../db';
import { redactTextForLog } from '../../services/logSanitizer';

/**
 * `timeoutMs`, if given, kills the process (SIGTERM) and rejects with a distinct "timed out"
 * message instead of waiting forever — this step runs once per page in the main pipeline, so
 * with `PROCESS_CONCURRENCY` defaulting to 2, a single stuck ffmpeg call here is enough to stall
 * the entire processing queue (same class of issue already fixed for yt-dlp/ffmpeg in
 * youtubeCaptions.ts and for generateVideo.ts's ffmpeg calls).
 */
/** Exported for unit testing; not part of this module's public synthesis API. */
export function runCommand(command: string, args: string[], timeoutMs?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeoutMs)
      : null;
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs}ms and was killed`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

// Re-exported (imported at top) so existing importers keep working.
export { parseWavPcmChunk, buildWavPcm16 };

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
  /** Reason the page was skipped (i.e. TTS failed after all retries), if any. */
  error: string | null;
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
  onPage?: (pageNumber: number, done: number, info?: { startedAt: string; endedAt: string; skipped: boolean; audioPath: string; durationSeconds: number | null; error: string | null }) => void;
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

export function isRetryableTtsError(err: unknown): boolean {
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

/**
 * Build a human-readable error message for a failed TTS attempt, including
 * the HTTP status / error code when available so the reason shown in the
 * console and UI is actionable (e.g. "401 invalid_api_key: Incorrect API key").
 */
export function extractTtsErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as { status?: unknown; code?: unknown; type?: unknown; message?: unknown };
  const status = typeof e.status === 'number' ? e.status : null;
  const code = typeof e.code === 'string' ? e.code : null;
  const type = typeof e.type === 'string' ? e.type : null;
  const message = typeof e.message === 'string' ? e.message : String(err);
  const prefix = [status != null ? String(status) : null, code ?? type]
    .filter((v): v is string => !!v)
    .join(' ');
  return prefix ? `${prefix}: ${message}` : message;
}

export function splitByToneMarkers(script: string): Array<{ instruction: string; text: string }> {
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
export function splitSpeakerPrefix(text: string): { speaker: '1' | '2' | null; text: string } {
  const m = SPEAKER_PREFIX_RE.exec(text);
  if (!m) return { speaker: null, text };
  return { speaker: m[1] as '1' | '2', text: text.slice(m[0].length).trim() };
}

/**
 * Builds and persists a Whisper-aligned subtitle timeline for one page, used by the
 * "subtitleSyncMode === 'whisper'" precision mode. Never throws — a transcription failure (e.g.
 * no OpenAI key configured even though TTS itself uses Gemini, a transient API error) just means
 * no timeline file gets written, and the frontend transparently falls back to its own
 * character-count estimate for that page, exactly as it already does when this mode is off.
 */
async function writeWhisperTimelineIfEnabled(params: {
  pdfId: string;
  pageNumber: number;
  pageUid: string;
  script: string;
  audioPath: string;
}): Promise<void> {
  const { pdfId, pageNumber, pageUid, script, audioPath } = params;
  const sentences = splitScriptIntoSentences(script);
  if (sentences.length === 0) return;
  try {
    const audioBuffer = await fs.promises.readFile(audioPath);
    const words = await transcribeAudioBufferWithWordTimestamps(audioBuffer, `${pageUid}.m4a`, 'audio/mp4');
    if (words.length === 0) return;
    const timeline = alignSentencesToWordTimestamps(sentences, words);
    await fs.promises.writeFile(pageTimelinePath(pdfId, pageUid), JSON.stringify(timeline), 'utf8');
  } catch (err) {
    logger.warn(
      { err, pdfId, pageNumber },
      'synthesizeAudio: failed to build Whisper subtitle timeline, falling back to estimate',
    );
  }
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
  // 舊版 Gemini 腳本以 {{語氣}} 描述情緒，TTS 不保證會略過、偶爾照唸；
  // 新版腳本已改用英文中括號標籤（如 [excitedly]），這裡將殘留的 {{...}} 一律移除。
  input = input.replace(/\{\{[^{}]*\}\}/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  if (!input) {
    throw new Error(`Page ${pageNumber} has empty script after removing tone markers, cannot synthesize`);
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
        logger.debug(
          {
            pdfId,
            pageNumber,
            instruction: seg.instruction,
            text: redactTextForLog(seg.text),
            chars: seg.text.length,
            voice: seg.voice,
            provider,
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
        await runCommand(
          FFMPEG,
          ['-y', '-i', tmpInputPath, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', targetPath],
          AUDIO_TRANSCODE_TIMEOUT_MS,
        );
      } finally {
        await fs.promises.rm(tmpInputPath, { force: true });
      }

      const latencyMs = Date.now() - startedAt;
      const duration = await readAudioDuration(targetPath);

      if (runtime.subtitleSyncMode === 'whisper') {
        await writeWhisperTimelineIfEnabled({ pdfId, pageNumber, pageUid, script, audioPath: targetPath });
      } else {
        // Audio just got regenerated under 'estimate' mode — remove any timeline left over from
        // a previous generation made while 'whisper' mode was on, so the frontend doesn't keep
        // serving stale alignment for narration that's no longer there.
        await fs.promises.rm(pageTimelinePath(pdfId, pageUid), { force: true });
      }

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
        error: null,
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

  const errorMessage = extractTtsErrorMessage(lastErr);
  logger.error(
    {
      pdfId,
      pageNumber,
      attempts: TTS_MAX_ATTEMPTS,
      error: errorMessage,
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
    error: errorMessage,
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
            error: res.error,
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
