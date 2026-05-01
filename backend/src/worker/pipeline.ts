import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { db } from '../db';
import { logger } from '../logger';
import {
  pageImagePath,
  pageScriptPath,
  pageTextPath,
  pdfDir,
  readMetadata,
  sourceTextPath,
  writeMetadata,
} from '../services/storage';
import type {
  PageRow,
  PageStatus,
  PdfMetadata,
  PdfMetadataModels,
  PdfMetadataPage,
  PdfMetadataUsage,
  PdfRow,
  PdfStatus,
  ProgressStep,
} from '../types';
import { renderPages } from './steps/renderPages';
import { renderTextPagesWithLlm } from './steps/renderTextPagesWithLlm';
import { splitTextWithLlm } from './steps/splitTextWithLlm';
import { extractText } from './steps/extractText';
import { generateScript } from './steps/generateScript';
import { generateTitle } from './steps/generateTitle';
import {
  readScriptsForTts,
  synthesizeAudio,
} from './steps/synthesizeAudio';
import { getProcessingQueue } from './queue';

function nowIso(): string {
  return new Date().toISOString();
}

function toRelative(pdfId: string, absPath: string): string {
  return path.relative(pdfDir(pdfId), absPath);
}

function updatePdf(
  pdfId: string,
  fields: Partial<{
    status: PdfStatus;
    progress_step: ProgressStep;
    progress_current: number | null;
    progress_total: number | null;
    page_count: number | null;
    error_message: string | null;
    title: string | null;
    user_prompt: string | null;
  }>,
): void {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k] ?? null);
  const updatedAt = nowIso();
  db.prepare(`UPDATE pdfs SET ${set}, updated_at = ? WHERE id = ?`).run(
    ...values,
    updatedAt,
    pdfId,
  );
}

/**
 * Set progress step + counters atomically so a concurrent GET never sees a
 * stale (step, current, total) tuple.
 */
function setProgress(
  pdfId: string,
  step: ProgressStep,
  current: number,
  total: number,
): void {
  updatePdf(pdfId, {
    progress_step: step,
    progress_current: current,
    progress_total: total,
  });
}

/** Bump progress_current without changing step/total. */
function bumpProgress(pdfId: string, current: number): void {
  updatePdf(pdfId, { progress_current: current });
}

function getPdfRow(pdfId: string): PdfRow | undefined {
  return db
    .prepare(
      `SELECT id, title, original_filename, status, page_count, progress_step,
              progress_current, progress_total,
              error_message, user_prompt, created_at, updated_at
         FROM pdfs WHERE id = ?`,
    )
    .get(pdfId) as PdfRow | undefined;
}

function listPageRows(pdfId: string): PageRow[] {
  return db
    .prepare(
      `SELECT pdf_id, page_number, image_path, text_path, script_path,
              audio_path, audio_duration_seconds, status, error_message,
              created_at, updated_at
         FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
    )
    .all(pdfId) as PageRow[];
}

function upsertPage(
  pdfId: string,
  pageNumber: number,
  fields: Partial<{
    image_path: string | null;
    text_path: string | null;
    script_path: string | null;
    audio_path: string | null;
    audio_duration_seconds: number | null;
    status: PageStatus;
    error_message: string | null;
  }>,
): void {
  const now = nowIso();
  const existing = db
    .prepare(
      `SELECT page_number FROM pages WHERE pdf_id = ? AND page_number = ?`,
    )
    .get(pdfId, pageNumber) as { page_number: number } | undefined;
  if (existing) {
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    if (keys.length === 0) return;
    const set = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => fields[k] ?? null);
    db.prepare(
      `UPDATE pages SET ${set}, updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
    ).run(...values, now, pdfId, pageNumber);
  } else {
    db.prepare(
      `INSERT INTO pages
        (pdf_id, page_number, image_path, text_path, script_path, audio_path,
         audio_duration_seconds, status, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      pdfId,
      pageNumber,
      fields.image_path ?? null,
      fields.text_path ?? null,
      fields.script_path ?? null,
      fields.audio_path ?? null,
      fields.audio_duration_seconds ?? null,
      fields.status ?? 'pending',
      fields.error_message ?? null,
      now,
      now,
    );
  }
}

/**
 * Rebuild the `pages[]` section of metadata.json by merging DB state with
 * existing page-level flags (text_empty, script_chars, script_generated_at).
 * Preserves `models`, `usage`, `notes`.
 */
async function persistMetadata(
  pdfId: string,
  extras: Partial<{
    models: PdfMetadataModels;
    usage: PdfMetadataUsage;
    notes: string;
  }> = {},
): Promise<void> {
  const row = getPdfRow(pdfId);
  if (!row) return;
  const pageRows = listPageRows(pdfId);
  const existing = (await readMetadata(pdfId)) ?? null;

  const pages: PdfMetadataPage[] = pageRows.map((p) => {
    const prev = existing?.pages.find((ep) => ep.page_number === p.page_number);
    const merged: PdfMetadataPage = {
      page_number: p.page_number,
      image: p.image_path,
      text: p.text_path,
      status: p.status,
    };
    if (p.script_path) merged.script = p.script_path;
    if (p.audio_path) merged.audio = p.audio_path;
    if (p.audio_duration_seconds != null) {
      merged.audio_duration_seconds = p.audio_duration_seconds;
    }
    if (prev?.text_empty) merged.text_empty = true;
    if (prev?.script_chars !== undefined) merged.script_chars = prev.script_chars;
    if (prev?.script_generated_at !== undefined) {
      merged.script_generated_at = prev.script_generated_at;
    }
    if (prev?.audio_chars !== undefined) merged.audio_chars = prev.audio_chars;
    if (prev?.audio_generated_at !== undefined) {
      merged.audio_generated_at = prev.audio_generated_at;
    }
    return merged;
  });

  const models: PdfMetadataModels | undefined =
    extras.models ?? existing?.models;
  const usage: PdfMetadataUsage | undefined =
    extras.usage ?? existing?.usage;

  const meta: PdfMetadata = {
    id: row.id,
    title: row.title,
    original_filename: row.original_filename,
    status: row.status,
    progress_step: row.progress_step,
    progress_current: row.progress_current,
    progress_total: row.progress_total,
    page_count: row.page_count,
    error_message: row.error_message,
    user_prompt: row.user_prompt,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pages,
    ...(extras.notes
      ? { notes: extras.notes }
      : existing?.notes
        ? { notes: existing.notes }
        : {}),
    ...(models ? { models } : {}),
    ...(usage ? { usage } : {}),
  };
  await writeMetadata(pdfId, meta);
}

/**
 * Patch a single page's metadata entry with script-specific fields
 * (script_chars, script_generated_at) without losing unrelated fields.
 */
async function patchPageMetadata(
  pdfId: string,
  pageNumber: number,
  fields: Partial<PdfMetadataPage>,
): Promise<void> {
  const existing = await readMetadata(pdfId);
  if (!existing) return;
  const idx = existing.pages.findIndex((p) => p.page_number === pageNumber);
  if (idx === -1) return;
  const current = existing.pages[idx];
  if (!current) return;
  existing.pages[idx] = {
    ...current,
    ...fields,
    page_number: current.page_number,
  } as PdfMetadataPage;
  await writeMetadata(pdfId, existing);
}

async function runPipeline(pdfId: string): Promise<void> {
  const row = getPdfRow(pdfId);
  if (!row) {
    logger.warn({ pdfId }, 'Pipeline: pdf row missing, skipping');
    return;
  }
  // Idempotency guard
  if (row.status === 'ready' || row.status === 'failed') {
    logger.info({ pdfId, status: row.status }, 'Pipeline: skip (terminal state)');
    return;
  }

  logger.info(
    { pdfId, resumeFrom: row.progress_step ?? 'start' },
    'Pipeline: start',
  );
  updatePdf(pdfId, {
    status: 'processing',
    error_message: null,
  });
  await persistMetadata(pdfId);

  try {
    // -------- Step 1: render pages + cover --------
    let pageCount = row.page_count;
    const alreadyRendered =
      row.progress_step === 'extracting_text' ||
      row.progress_step === 'text_extracted' ||
      row.progress_step === 'scripting' ||
      row.progress_step === 'script_ready';
    if (!alreadyRendered || !pageCount) {
      // pdftoppm renders every page in a single spawn so we can only surface
      // 0/? → pageCount/pageCount. For TXT+LLM image generation we can expose
      // per-page progress because we know the split result up-front.
      setProgress(pdfId, 'rendering', 0, 0);
      await persistMetadata(pdfId);
      const isTextImport = fs.existsSync(sourceTextPath(pdfId));
      const r = isTextImport
        ? await (async () => {
            const raw = await fs.promises.readFile(sourceTextPath(pdfId), 'utf8');
            const split = await splitTextWithLlm(raw);
            setProgress(pdfId, 'rendering', 0, split.pages.length);
            await persistMetadata(pdfId);
            return await renderTextPagesWithLlm({
              pdfId,
              pages: split.pages,
              onPage: (n, imagePath) => {
                upsertPage(pdfId, n, {
                  image_path: toRelative(pdfId, imagePath),
                  status: 'rendered',
                });
                bumpProgress(pdfId, n);
              },
            });
          })()
        : await renderPages(pdfId);
      pageCount = r.pageCount;
      updatePdf(pdfId, { page_count: pageCount });
      setProgress(pdfId, 'rendering', 0, pageCount);
      for (let i = 0; i < r.pagePaths.length; i++) {
        const abs = r.pagePaths[i];
        if (!abs) continue;
        const pageNumber = i + 1;
        if (!isTextImport) {
          upsertPage(pdfId, pageNumber, {
            image_path: toRelative(pdfId, abs),
            status: 'rendered',
          });
          bumpProgress(pdfId, pageNumber);
        }
      }
      await persistMetadata(pdfId);
    } else {
      logger.info({ pdfId, pageCount }, 'Pipeline: reuse rendered pages (resume)');
    }

    if (!pageCount) {
      throw new Error('pageCount unavailable after render step');
    }

    // -------- Step 2: extract text --------
    const alreadyTextDone =
      row.progress_step === 'text_extracted' ||
      row.progress_step === 'scripting' ||
      row.progress_step === 'script_ready';

    let textResult: Array<{ pageNumber: number; empty: boolean; textPath: string }>;
    if (!alreadyTextDone) {
      setProgress(pdfId, 'extracting_text', 0, pageCount);
      await persistMetadata(pdfId);
      const { pages } = await extractText(pdfId, pageCount, (pageNumber) => {
        bumpProgress(pdfId, pageNumber);
      });
      textResult = pages;
      for (const p of pages) {
        upsertPage(pdfId, p.pageNumber, {
          text_path: toRelative(pdfId, p.textPath),
          status: 'text_ready',
        });
      }
      updatePdf(pdfId, {
        progress_step: 'text_extracted',
        progress_current: pageCount,
        progress_total: pageCount,
        error_message: null,
      });

      // Merge text_empty flags into metadata.json
      const existingMeta = (await readMetadata(pdfId)) ?? null;
      const row2 = getPdfRow(pdfId);
      const pageRows = listPageRows(pdfId);
      const metaPages: PdfMetadataPage[] = pageRows.map((pr) => {
        const info = pages.find((t) => t.pageNumber === pr.page_number);
        return {
          page_number: pr.page_number,
          image: pr.image_path,
          text: pr.text_path,
          status: pr.status,
          ...(info?.empty ? { text_empty: true } : {}),
        };
      });
      if (row2) {
        const meta: PdfMetadata = {
          id: row2.id,
          title: row2.title,
          original_filename: row2.original_filename,
          status: row2.status,
          progress_step: row2.progress_step,
          progress_current: row2.progress_current,
          progress_total: row2.progress_total,
          page_count: row2.page_count,
          error_message: row2.error_message,
          user_prompt: row2.user_prompt,
          created_at: row2.created_at,
          updated_at: row2.updated_at,
          pages: metaPages,
          notes:
            (existingMeta?.notes ? existingMeta.notes + ' | ' : '') +
            'M2 complete: pages rendered + text extracted',
          ...(existingMeta?.models ? { models: existingMeta.models } : {}),
          ...(existingMeta?.usage ? { usage: existingMeta.usage } : {}),
        };
        await writeMetadata(pdfId, meta);
      }
      logger.info({ pdfId, pageCount }, 'Pipeline: M2 stages complete');
    } else {
      // Rebuild textResult from disk + metadata on resume.
      const existingMeta = (await readMetadata(pdfId)) ?? null;
      textResult = [];
      for (let n = 1; n <= pageCount; n++) {
        const tp = pageTextPath(pdfId, n, pageCount);
        const empty = !!existingMeta?.pages.find((p) => p.page_number === n)?.text_empty;
        textResult.push({ pageNumber: n, empty, textPath: tp });
      }
      logger.info({ pdfId, pageCount }, 'Pipeline: reuse extracted text (resume)');
    }

    // -------- Step 3 (M3): generate per-page script --------
    // Cost guardrail: keep the legacy page cap for PDF inputs. TXT imports
    // can legitimately produce many short pages and should not be blocked by
    // the PDF-centric hard limit.
    const isTextImport = fs.existsSync(sourceTextPath(pdfId));
    if (!isTextImport && pageCount > config.openaiMaxPages) {
      throw new Error(
        `PDF 頁數超過 LLM 處理上限 (${config.openaiMaxPages})，請聯絡管理員或分批上傳`,
      );
    }

    setProgress(pdfId, 'scripting', 0, pageCount);
    updatePdf(pdfId, { error_message: null });
    await persistMetadata(pdfId);

    // Read per-page text (required as prompt input) and remember the
    // rendered PNG path so the LLM can also see the slide image.
    const pagesForScript: Array<{
      pageNumber: number;
      text: string;
      empty: boolean;
      imagePath: string;
    }> = [];
    for (const t of textResult) {
      let content = '';
      try {
        content = await fs.promises.readFile(t.textPath, 'utf8');
      } catch {
        content = '';
      }
      pagesForScript.push({
        pageNumber: t.pageNumber,
        text: content,
        empty: t.empty,
        imagePath: pageImagePath(pdfId, t.pageNumber, pageCount),
      });
    }

    // Fetch the latest row to pick up the user prompt submitted via
    // POST /api/pdfs/:id/start (may be null / empty if the user skipped).
  const rowWithPrompt = getPdfRow(pdfId);
  const userPrompt = rowWithPrompt?.user_prompt ?? null;
  const scriptMaxCharsPerPage = rowWithPrompt?.script_max_chars_per_page ?? null;

    const scriptResult = await generateScript({
      pdfId,
      pageCount,
      pages: pagesForScript,
      userPrompt,
      maxCharsPerPage: scriptMaxCharsPerPage,
      onPage: (_pageNumber, done) => {
        bumpProgress(pdfId, done);
      },
    });

    // Persist per-page script_path + script_ready status.
    for (const sp of scriptResult.pages) {
      upsertPage(pdfId, sp.pageNumber, {
        script_path: toRelative(pdfId, sp.scriptPath),
        status: 'script_ready',
      });
    }

    // Merge models + usage + per-page extras into metadata.json.
    const existingMeta = (await readMetadata(pdfId)) ?? null;
    const prevUsage = existingMeta?.usage ?? {};
    const mergedUsage: PdfMetadataUsage = {
      llm_prompt_tokens_total:
        (prevUsage.llm_prompt_tokens_total ?? 0) +
        scriptResult.totalUsage.prompt_tokens,
      llm_completion_tokens_total:
        (prevUsage.llm_completion_tokens_total ?? 0) +
        scriptResult.totalUsage.completion_tokens,
      llm_tokens_total:
        (prevUsage.llm_tokens_total ?? 0) +
        scriptResult.totalUsage.total_tokens,
    };
    const mergedModels: PdfMetadataModels = {
      ...(existingMeta?.models ?? {}),
      llm: config.openaiLlmModel,
    };

    await persistMetadata(pdfId, {
      models: mergedModels,
      usage: mergedUsage,
    });

    for (const sp of scriptResult.pages) {
      await patchPageMetadata(pdfId, sp.pageNumber, {
        script: toRelative(pdfId, sp.scriptPath),
        script_chars: sp.chars,
        script_generated_at: sp.generatedAt,
      });
    }

    setProgress(pdfId, 'script_ready', pageCount, pageCount);
    await persistMetadata(pdfId);

    logger.info(
      {
        pdfId,
        pageCount,
        generated: scriptResult.pages.filter((p) => !p.skipped).length,
        skipped: scriptResult.pages.filter((p) => p.skipped).length,
        usage: scriptResult.totalUsage,
      },
      'Pipeline: M3 script stage complete',
    );

    // -------- Step 4 (M3): generate deck title (non-fatal) --------
    try {
      const titleResult = await generateTitle(pdfId, pageCount, { userPrompt });
      updatePdf(pdfId, { title: titleResult.title });

      const afterUsage: PdfMetadataUsage = {
        llm_prompt_tokens_total:
          (mergedUsage.llm_prompt_tokens_total ?? 0) +
          titleResult.usage.prompt_tokens,
        llm_completion_tokens_total:
          (mergedUsage.llm_completion_tokens_total ?? 0) +
          titleResult.usage.completion_tokens,
        llm_tokens_total:
          (mergedUsage.llm_tokens_total ?? 0) + titleResult.usage.total_tokens,
      };
      await persistMetadata(pdfId, {
        models: mergedModels,
        usage: afterUsage,
      });
      logger.info(
        {
          pdfId,
          title: titleResult.title,
          source: titleResult.source,
          usage: titleResult.usage,
        },
        'Pipeline: title generated',
      );
    } catch (err) {
      logger.warn(
        {
          pdfId,
          error: err instanceof Error ? err.message : String(err),
        },
        'Pipeline: title generation failed (non-fatal, keeping original title)',
      );
    }

    // -------- Step 5 (M4): per-page TTS synthesis --------
    const latestAfterScript = getPdfRow(pdfId);
    if (latestAfterScript?.require_script_confirmation === 1) {
      updatePdf(pdfId, {
        status: 'awaiting_script_confirmation',
        progress_step: 'script_ready',
        progress_current: pageCount,
        progress_total: pageCount,
        error_message: null,
      });
      await persistMetadata(pdfId, {
        notes: 'Script generated; awaiting user confirmation before TTS',
      });
      logger.info({ pdfId }, 'Pipeline: waiting for script confirmation');
      return;
    }

    const scriptsForTts = await readScriptsForTts(pdfId, pageCount);
    const nonEmptyScripts = scriptsForTts.filter(
      (s) => s.script.trim().length > 0,
    );
    if (nonEmptyScripts.length === 0) {
      throw new Error('No page scripts available for TTS synthesis');
    }

    setProgress(pdfId, 'synthesizing', 0, nonEmptyScripts.length);
    updatePdf(pdfId, { error_message: null });
    await persistMetadata(pdfId);

    const ttsResult = await synthesizeAudio({
      pdfId,
      pageCount,
      pages: nonEmptyScripts,
      voice: rowWithPrompt?.tts_voice ?? null,
      speed: rowWithPrompt?.tts_speed ?? null,
      onPage: (_pageNumber, done) => {
        bumpProgress(pdfId, done);
      },
    });

    // Persist per-page audio_path, duration, status.
    for (const a of ttsResult.pages) {
      upsertPage(pdfId, a.pageNumber, {
        audio_path: toRelative(pdfId, a.audioPath),
        audio_duration_seconds: a.durationSeconds,
        status: 'audio_ready',
      });
    }

    // Merge tts chars + model info into metadata.
    const metaAfterScript = (await readMetadata(pdfId)) ?? null;
    const prevUsage2 = metaAfterScript?.usage ?? {};
    const mergedUsage2: PdfMetadataUsage = {
      ...prevUsage2,
      tts_chars_total:
        (prevUsage2.tts_chars_total ?? 0) + ttsResult.totalChars,
    };
    const mergedModels2: PdfMetadataModels = {
      ...(metaAfterScript?.models ?? {}),
      tts: config.openaiTtsModel,
      voice: config.openaiTtsVoice,
      format: config.openaiTtsFormat,
      speed: config.openaiTtsSpeed,
    };

    await persistMetadata(pdfId, {
      models: mergedModels2,
      usage: mergedUsage2,
    });

    for (const a of ttsResult.pages) {
      await patchPageMetadata(pdfId, a.pageNumber, {
        audio: toRelative(pdfId, a.audioPath),
        audio_chars: a.chars,
        audio_generated_at: a.generatedAt,
        audio_duration_seconds: a.durationSeconds,
      });
    }

    // All pages audio_ready → PDF ready.
    updatePdf(pdfId, {
      status: 'ready',
      progress_step: null,
      progress_current: null,
      progress_total: null,
      error_message: null,
    });
    await persistMetadata(pdfId, {
      models: mergedModels2,
      usage: mergedUsage2,
    });

    logger.info(
      {
        pdfId,
        pageCount,
        generatedAudio: ttsResult.pages.filter((p) => !p.skipped).length,
        skippedAudio: ttsResult.pages.filter((p) => p.skipped).length,
        ttsCharsTotal: ttsResult.totalChars,
      },
      'Pipeline: M4 TTS stage complete — pdf ready',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, pdfId }, 'Pipeline failed');
    updatePdf(pdfId, {
      status: 'failed',
      error_message: message,
    });
    await persistMetadata(pdfId).catch(() => undefined);
  }
}

/**
 * Track PDFs currently being processed to avoid duplicate enqueue calls
 * triggered by fast consecutive API requests or the startup rescan.
 */
const inFlight = new Set<string>();

export function enqueuePdfProcessing(pdfId: string): void {
  if (inFlight.has(pdfId)) {
    logger.info({ pdfId }, 'Pipeline: already in flight, skipping enqueue');
    return;
  }
  const row = getPdfRow(pdfId);
  if (!row) {
    logger.warn({ pdfId }, 'Pipeline: pdf row missing at enqueue');
    return;
  }
  if (row.status === 'ready' || row.status === 'failed') {
    logger.info({ pdfId, status: row.status }, 'Pipeline: skip enqueue (terminal)');
    return;
  }
  if (row.status === 'awaiting_prompt' || row.status === 'awaiting_script_confirmation') {
    // Caller forgot to submit POST /api/pdfs/:id/start first. Don't auto-
    // kick the pipeline — we'd lose the chance to use the user prompt.
    logger.info(
      { pdfId },
      'Pipeline: skip enqueue (awaiting_prompt — user has not submitted style prompt yet)',
    );
    return;
  }

  inFlight.add(pdfId);
  const queue = getProcessingQueue();
  void queue
    .add(async () => {
      try {
        await runPipeline(pdfId);
      } finally {
        inFlight.delete(pdfId);
      }
    })
    .catch((err) => {
      logger.error({ err, pdfId }, 'Pipeline task rejected');
      inFlight.delete(pdfId);
    });
}

/**
 * Startup crash-recovery: re-enqueue any PDFs that were left mid-pipeline
 * when the server stopped. Call once at boot.
 */
export function rescanPendingOnStartup(): void {
  // Only rows that already have a style prompt (or an explicit skip, i.e.
  // status = 'uploaded' with user_prompt NULL after start was called) are
  // re-enqueued. `awaiting_prompt` rows stay put until the user submits
  // their prompt from the frontend.
  const rows = db
    .prepare(
      `SELECT id FROM pdfs WHERE status IN ('uploaded', 'processing') ORDER BY created_at ASC`,
    )
    .all() as Array<{ id: string }>;
  if (rows.length === 0) {
    logger.info('Startup rescan: no pending PDFs');
    return;
  }
  logger.info({ count: rows.length }, 'Startup rescan: re-enqueueing PDFs');
  for (const r of rows) {
    enqueuePdfProcessing(r.id);
  }
}
