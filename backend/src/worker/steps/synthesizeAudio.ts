import fs from 'node:fs';
import PQueue from 'p-queue';
import { parseFile } from 'music-metadata';
import { APIError } from 'openai';
import { config } from '../../config';
import { logger } from '../../logger';
import { getOpenAIClient } from '../../services/openai';
import { pageAudioPath, pageScriptPath } from '../../services/storage';

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

export interface SynthesizeAudioPageResult {
  pageNumber: number;
  audioPath: string;
  chars: number;
  bytes: number;
  durationSeconds: number | null;
  generatedAt: string;
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
  onPage?: (pageNumber: number, done: number) => void;
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

async function synthesizeOnePage(params: {
  pdfId: string;
  pageNumber: number;
  pageCount: number;
  script: string;
  voice: string;
  speed: number;
  shouldAbort?: () => boolean;
}): Promise<SynthesizeAudioPageResult> {
  const { pdfId, pageNumber, pageCount, script, voice, speed, shouldAbort } = params;
  if (shouldAbort?.()) {
    const err = new Error('CANCELLED');
    (err as Error & { code?: string }).code = 'CANCELLED';
    throw err;
  }
  const absPath = pageAudioPath(pdfId, pageNumber, pageCount);

  // Always regenerate audio so updated voice/speed settings reliably apply.

  let input = script.trim();
  if (!input) {
    throw new Error(`Page ${pageNumber} has empty script, cannot synthesize`);
  }
  const rawSegments = splitByToneMarkers(input);
  const segments = rawSegments.map((seg) => {
    if (seg.text.length <= TTS_INPUT_MAX_CHARS) return seg;
    logger.warn(
      {
        pdfId,
        pageNumber,
        originalChars: seg.text.length,
        maxChars: TTS_INPUT_MAX_CHARS,
      },
      'synthesizeAudio: segment exceeds TTS input limit, truncating',
    );
    return {
      ...seg,
      text: seg.text.slice(0, TTS_INPUT_MAX_CHARS),
    };
  });

  const client = getOpenAIClient();
  let lastErr: unknown;
  let delayMs = TTS_RETRY_INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= TTS_MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
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
        const response = await client.audio.speech.create({
          model: config.openaiTtsModel,
          voice,
          input: seg.text,
          response_format: config.openaiTtsFormat,
          speed,
        });
        const b = Buffer.from(await response.arrayBuffer());
        if (b.byteLength === 0) {
          throw new Error('OpenAI returned empty audio buffer');
        }
        buffers.push(b);
      }
      const buffer = Buffer.concat(buffers);
      await fs.promises.writeFile(absPath, buffer);

      const latencyMs = Date.now() - startedAt;
      const duration = await readAudioDuration(absPath);

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
          model: config.openaiTtsModel,
        },
        'synthesizeAudio: page done',
      );

      return {
        pageNumber,
        audioPath: absPath,
        chars: input.length,
        bytes: buffer.byteLength,
        durationSeconds: duration,
        generatedAt: new Date().toISOString(),
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
    audioPath: absPath,
    chars: input.length,
    bytes: 0,
    durationSeconds: null,
    generatedAt: new Date().toISOString(),
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
  const voice = opts.voice?.trim() || config.openaiTtsVoice;
  const speed = opts.speed ?? config.openaiTtsSpeed;
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);

  const queue = new PQueue({ concurrency: config.ttsConcurrency });
  const results: SynthesizeAudioPageResult[] = new Array(sorted.length);
  let done = 0;
  let cancelled = false;

  await Promise.all(
    sorted.map((page, idx) =>
      queue.add(async () => {
        try {
          const res = await synthesizeOnePage({
            pdfId,
            pageNumber: page.pageNumber,
            pageCount,
            script: page.script,
            voice,
            speed,
            shouldAbort,
          });
          results[idx] = res;
          done += 1;
          onPage?.(page.pageNumber, done);
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
  const out: Array<{ pageNumber: number; script: string }> = [];
  for (let n = 1; n <= pageCount; n++) {
    const p = pageScriptPath(pdfId, n, pageCount);
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
