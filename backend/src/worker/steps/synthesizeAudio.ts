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

  // Idempotency: if file already present and non-empty, reuse it.
  try {
    const st = await fs.promises.stat(absPath);
    if (st.isFile() && st.size > 0) {
      const duration = await readAudioDuration(absPath);
      logger.info(
        {
          pdfId,
          pageNumber,
          bytes: st.size,
          durationSeconds: duration,
        },
        'synthesizeAudio: reuse existing mp3 (idempotent skip)',
      );
      return {
        pageNumber,
        audioPath: absPath,
        chars: script.length,
        bytes: st.size,
        durationSeconds: duration,
        generatedAt: new Date().toISOString(),
        latencyMs: 0,
        skipped: true,
      };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // proceed to synthesize
  }

  let input = script.trim();
  if (!input) {
    throw new Error(`Page ${pageNumber} has empty script, cannot synthesize`);
  }
  if (input.length > TTS_INPUT_MAX_CHARS) {
    logger.warn(
      {
        pdfId,
        pageNumber,
        originalChars: input.length,
        maxChars: TTS_INPUT_MAX_CHARS,
      },
      'synthesizeAudio: script exceeds TTS input limit, truncating',
    );
    input = input.slice(0, TTS_INPUT_MAX_CHARS);
  }

  const client = getOpenAIClient();
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await client.audio.speech.create({
        model: config.openaiTtsModel,
        voice,
        input,
        response_format: config.openaiTtsFormat,
        speed,
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0) {
        throw new Error('OpenAI returned empty audio buffer');
      }
      await fs.promises.writeFile(absPath, buffer);

      const latencyMs = Date.now() - startedAt;
      const duration = await readAudioDuration(absPath);

      logger.info(
        {
          pdfId,
          pageNumber,
          chars: input.length,
          bytes: buffer.byteLength,
          durationSeconds: duration,
          latencyMs,
          attempt,
          voice,
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
      logger.warn(
        {
          pdfId,
          pageNumber,
          attempt,
          latencyMs,
          status: apiErr?.status,
          code: apiErr?.code,
          error: err instanceof Error ? err.message : String(err),
        },
        'synthesizeAudio: attempt failed',
      );
    }
  }

  throw new Error(
    `Page ${pageNumber} TTS synthesis failed after ${MAX_ATTEMPTS} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/**
 * Per-page OpenAI TTS synthesis driven by a small in-process p-queue so we
 * run multiple pages concurrently (bounded by `TTS_CONCURRENCY`). Idempotent:
 * any existing non-empty mp3 on disk is reused without calling the API.
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
  const errors: Array<{ pageNumber: number; error: unknown }> = [];
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
          } else {
            errors.push({ pageNumber: page.pageNumber, error: err });
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

  if (errors.length > 0) {
    const first = errors[0]!;
    throw new Error(
      `synthesizeAudio: ${errors.length} page(s) failed (first: p${first.pageNumber}: ${
        first.error instanceof Error ? first.error.message : String(first.error)
      })`,
    );
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
