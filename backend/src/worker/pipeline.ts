import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { nanoid } from 'nanoid';
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
  writeSourceText,
  youtubeCaptionsNormalizedPath,
  youtubeCaptionsRawPath,
  youtubeOutlinePath,
  writeMetadata,
} from '../services/storage';
import { fetchYoutubeCaptions } from '../services/youtubeCaptions';
import { callChatJSON } from '../services/openai';
import { getRuntimeAiSettings } from '../services/aiSettings';
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
import {
  finishArtifact,
  finishRun,
  finishStage,
  recordApproxArtifact,
  startArtifact,
  startRun,
  startStage,
  type TimingArtifactHandle,
} from '../services/timing';

function nowIso(): string {
  return new Date().toISOString();
}

const YoutubeOutlineSchema = z.object({
  slides: z
    .array(
      z.object({
        title: z.string().min(1),
        bullets: z.array(z.string().min(1)).min(2).max(6).optional(),
        key_points: z.array(z.string().min(1)).min(2).max(6).optional(),
      }),
    )
    .min(3),
});

async function buildYoutubeOutlineAsSlideText(params: {
  videoId: string;
  language: string | null;
  normalizedText: string;
}): Promise<string> {
  const { videoId, language, normalizedText } = params;
  const trimmed = normalizedText.trim();
  if (!trimmed) {
    return [
      'Slide 1: 影片重點（無字幕）',
      '- 目前無可用字幕內容。',
      '- 請稍後重試或改用其他語言字幕。',
    ].join('\n');
  }

  const input = trimmed.length > 64000 ? trimmed.slice(0, 64000) : trimmed;
  const system = [
    '你是簡報大綱助理。',
    '請根據字幕內容整理成投影片大綱。',
    '務必輸出結構化 JSON，不要輸出 markdown。',
  ].join('\n');
  const user = [
    `影片 ID：${videoId}`,
    `字幕語言：${language ?? 'unknown'}`,
    '請根據逐字稿產生投影片大綱，需儘量包括影片內容。每頁需有標題與 2~6 點重點，放在 bullets 陣列之中。',
    '每一頁大綱重點要精簡、可讀、避免逐字轉錄。',
    '',
    '字幕內容如下：',
    input,
  ].join('\n');

  const r = await callChatJSON({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: YoutubeOutlineSchema,
    maxTokens: 6400,
    temperature: 0.4,
    label: 'youtube-outline-slide-text',
  });

  logger.info(
    {
      videoId,
      language: language ?? 'unknown',
      outlineJsonPretty: JSON.stringify(r.data, null, 2),
    },
    'YouTube outline LLM JSON (pretty)',
  );
  console.log(r.data);
  const lines: string[] = [];
  r.data.slides.forEach((s, idx) => {
    const normalizedBullets = (s.bullets ?? s.key_points ?? [])
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (normalizedBullets.length === 0) return;
    lines.push(`Slide ${idx + 1}: ${s.title.trim()}`);
    for (const b of normalizedBullets) lines.push(`- ${b}`);
    lines.push('');
  });
  const rendered = lines.join('\n').trim();
  console.log(rendered);
  if (rendered) return rendered;

  const fallbackPoints = trimmed
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 6);
  if (fallbackPoints.length === 0) {
    return [
      'Slide 1: 影片重點（暫無可用內容）',
      '- LLM 未產出可用條列。',
      '- 請稍後重試或調整字幕語言。',
    ].join('\n');
  }
  return [
    'Slide 1: 影片重點整理',
    ...fallbackPoints.map((p) => `- ${p}`),
  ].join('\n');
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
    total_audio_duration_seconds: number | null;
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

function sumAudioDurationSeconds(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      total += value;
      count += 1;
    }
  }
  return count > 0 ? Math.round(total * 1000) / 1000 : null;
}

function getPdfRow(pdfId: string): PdfRow | undefined {
  return db
    .prepare(
      `SELECT id, title, original_filename, status, page_count, progress_step,
              progress_current, progress_total,
              error_message, user_prompt, require_script_confirmation, require_split_confirmation,
              total_audio_duration_seconds,
              tts_voice, tts_speed, script_max_chars_per_page,
              source_type, source_url, source_video_id, source_caption_language,
              created_at, updated_at
         FROM pdfs WHERE id = ?`,
    )
    .get(pdfId) as PdfRow | undefined;
}

function listPageRows(pdfId: string): PageRow[] {
  return db
    .prepare(
      `SELECT pdf_id, page_number, page_uid, image_path, text_path, script_path,
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
    page_uid: string;
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
        (pdf_id, page_number, page_uid, image_path, text_path, script_path, audio_path,
         audio_duration_seconds, status, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      pdfId,
      pageNumber,
      fields.page_uid ?? nanoid(10),
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
    total_audio_duration_seconds: row.total_audio_duration_seconds ?? null,
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

  const runType = row.status === 'processing' || row.progress_step ? 'resume' : 'initial';
  const run = startRun({
    pdfId,
    runType,
    triggeredBy: runType === 'resume' ? 'startup_recovery' : 'system',
    metadata: { resumeFrom: row.progress_step ?? 'start', source_type: row.source_type ?? 'pdf' },
  });

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
    if ((row.source_type ?? 'pdf') === 'youtube') {
      const stage = startStage(run, 'source_prepare', { source_type: 'youtube' });
      const videoId = row.source_video_id ?? null;
      if (!videoId) {
        throw new Error('Missing source_video_id for youtube task');
      }
      setProgress(pdfId, 'downloading_captions', 0, 1);
      await persistMetadata(pdfId);
      const cap = await fetchYoutubeCaptions(
        videoId,
        row.source_caption_language ?? undefined,
        async (step) => {
          setProgress(pdfId, step, 0, 1);
          await persistMetadata(pdfId);
        },
      );

      await fs.promises.writeFile(
        youtubeCaptionsRawPath(pdfId),
        JSON.stringify({
          videoId,
          language: cap.language,
          lines: cap.lines,
        }, null, 2),
        'utf8',
      );
      await fs.promises.writeFile(youtubeCaptionsNormalizedPath(pdfId), cap.normalizedText, 'utf8');
      setProgress(pdfId, 'scripting', 0, 1);
      await persistMetadata(pdfId);

      const outline = await buildYoutubeOutlineAsSlideText({
        videoId,
        language: cap.language,
        normalizedText: cap.normalizedText,
      });
      await fs.promises.writeFile(youtubeOutlinePath(pdfId), outline, 'utf8');
      await writeSourceText(pdfId, outline);

      const now = nowIso();
      db.prepare(
        `UPDATE pdfs
            SET title = COALESCE(title, ?),
                source_caption_language = COALESCE(source_caption_language, ?),
                updated_at = ?
          WHERE id = ?`,
      ).run(`YouTube ${videoId}`, cap.language, now, pdfId);

      const m = await readMetadata(pdfId);
      if (m) {
        m.updated_at = now;
        m.source_type = 'youtube';
        m.source_video_id = videoId;
        m.source_caption_language = m.source_caption_language ?? cap.language ?? null;
        m.captions_raw = 'captions.raw.json';
        m.captions_normalized = 'captions.normalized.txt';
        m.outline = 'outline.md';
        await writeMetadata(pdfId, m);
      }
      logger.info(
        { pdfId, videoId, lines: cap.lines.length },
        'Pipeline: youtube captions + outline prepared, continue with TXT pipeline',
      );
      finishStage(stage, 'succeeded', { videoId, captions: cap.lines.length });
    }

    // -------- Step 1: render pages + cover --------
    let pageCount = row.page_count;
    const alreadyRendered =
      row.progress_step === 'extracting_text' ||
      row.progress_step === 'text_extracted' ||
      row.progress_step === 'scripting' ||
      row.progress_step === 'script_ready';
    if (!alreadyRendered || !pageCount) {
      const renderStage = startStage(run, 'render_pages', { alreadyRendered: false });
      // pdftoppm renders every page in a single spawn so we can only surface
      // 0/? → pageCount/pageCount. For TXT+LLM image generation we can expose
      // per-page progress because we know the split result up-front.
      setProgress(pdfId, 'rendering', 0, 0);
      await persistMetadata(pdfId);
      const isTextImport = fs.existsSync(sourceTextPath(pdfId));
      const renderStartedAtMs = Date.now();
      const textImageHandles = new Map<number, TimingArtifactHandle | null>();
      const r = isTextImport
        ? await (async () => {
            const existingPages = listPageRows(pdfId);
            if (existingPages.length > 0) {
              logger.info({ pdfId, pages: existingPages.length }, 'Pipeline: use existing split pages');
              const pages = existingPages.map((p) => {
                const textContent = fs.readFileSync(path.join(pdfDir(pdfId), p.text_path!), 'utf8');
                const lines = textContent.split('\n');
                const titleLine = lines[0] || '';
                const title = titleLine.replace(/^Slide \d+:\s*/i, '').trim();
                return {
                  pageNumber: p.page_number,
                  pageUid: p.page_uid,
                  content: textContent,
                  slideLabel: title || undefined,
                };
              });
              setProgress(pdfId, 'rendering', 0, pages.length);
              return await renderTextPagesWithLlm({
                pdfId,
                pages,
                onPage: (n, imagePath, info) => {
                  const h = textImageHandles.get(n) ?? startArtifact({ run, pageNumber: n, artifact: 'image', reason: runType === 'resume' ? 'resume' : 'initial', metadata: { source_type: 'text', precision: 'step_timing' } });
                  textImageHandles.set(n, h);
                  const status = info.status ?? (info.reused ? 'skipped' : 'succeeded');
                  finishArtifact(h, status, {
                    startedAt: info.startedAt,
                    endedAt: info.endedAt,
                    durationMs: info.latencyMs,
                    outputPath: status === 'failed' ? null : toRelative(pdfId, imagePath),
                    error: info.error ? { code: info.error.code ?? info.error.type ?? null, message: info.error.message } : undefined,
                    metadata: {
                      source_type: 'text',
                      precision: 'step_timing',
                      reused: info.reused,
                      attempt: info.attempt ?? null,
                      model: info.model ?? null,
                      promptLength: info.promptLength ?? null,
                      timeoutMs: info.timeoutMs ?? null,
                      errorStatus: info.error?.status ?? null,
                      errorType: info.error?.type ?? null,
                      ...(info.metadata ?? {}),
                    },
                  });
                  if (status === 'failed') {
                    upsertPage(pdfId, n, {
                      status: 'failed',
                      error_message: info.error?.message ?? 'Text image generation failed',
                    });
                    bumpProgress(pdfId, n);
                    return;
                  }
                  upsertPage(pdfId, n, {
                    image_path: toRelative(pdfId, imagePath),
                    status: 'rendered',
                  });
                  bumpProgress(pdfId, n);
                },
              });
            }

            const raw = await fs.promises.readFile(sourceTextPath(pdfId), 'utf8');
            const splitStage = startStage(run, 'split_text', { source_type: 'text' });
            const split = await splitTextWithLlm(raw);
            finishStage(splitStage, 'succeeded', { pages: split.pages.length });

            const pagesDir = path.join(pdfDir(pdfId), 'pages');
            if (!fs.existsSync(pagesDir)) {
              await fs.promises.mkdir(pagesDir, { recursive: true });
            }
            const splitPageUids = new Map<number, string>();
            for (const page of split.pages) {
              const pageText = page.content;
              const pageUid = nanoid(10);
              splitPageUids.set(page.pageNumber, pageUid);
              const textPath = pageTextPath(pdfId, pageUid);
              await fs.promises.writeFile(textPath, pageText, 'utf8');
              upsertPage(pdfId, page.pageNumber, {
                page_uid: pageUid,
                status: 'pending',
                text_path: toRelative(pdfId, textPath),
              });
            }
            await persistMetadata(pdfId);

            const latest = getPdfRow(pdfId);
            if (latest?.require_split_confirmation === 1) {
              updatePdf(pdfId, {
                status: 'awaiting_script_confirmation',
                progress_step: 'script_ready',
                progress_current: split.pages.length,
                progress_total: split.pages.length,
                error_message: null,
              });
              await persistMetadata(pdfId, {
                notes: 'Text split complete; awaiting user confirmation before rendering images',
              });
              logger.info({ pdfId }, 'Pipeline: waiting for split confirmation');
              throw new Error('AWAITING_SPLIT_CONFIRMATION');
            }

            setProgress(pdfId, 'rendering', 0, split.pages.length);
            return await renderTextPagesWithLlm({
              pdfId,
              pages: split.pages.map((p) => ({ ...p, pageUid: splitPageUids.get(p.pageNumber)! })),
              onPage: (n, imagePath, info) => {
                const h = textImageHandles.get(n) ?? startArtifact({ run, pageNumber: n, artifact: 'image', reason: runType === 'resume' ? 'resume' : 'initial', metadata: { source_type: 'text', precision: 'step_timing' } });
                textImageHandles.set(n, h);
                const status = info.status ?? (info.reused ? 'skipped' : 'succeeded');
                finishArtifact(h, status, {
                  startedAt: info.startedAt,
                  endedAt: info.endedAt,
                  durationMs: info.latencyMs,
                  outputPath: status === 'failed' ? null : toRelative(pdfId, imagePath),
                  error: info.error ? { code: info.error.code ?? info.error.type ?? null, message: info.error.message } : undefined,
                  metadata: {
                    source_type: 'text',
                    precision: 'step_timing',
                    reused: info.reused,
                    attempt: info.attempt ?? null,
                    model: info.model ?? null,
                    promptLength: info.promptLength ?? null,
                    timeoutMs: info.timeoutMs ?? null,
                    errorStatus: info.error?.status ?? null,
                    errorType: info.error?.type ?? null,
                    ...(info.metadata ?? {}),
                  },
                });
                if (status === 'failed') {
                  upsertPage(pdfId, n, {
                    status: 'failed',
                    error_message: info.error?.message ?? 'Text image generation failed',
                  });
                  bumpProgress(pdfId, n);
                  return;
                }
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
          const avgDuration = r.pagePaths.length > 0 ? (Date.now() - renderStartedAtMs) / r.pagePaths.length : 0;
          recordApproxArtifact({
            run,
            pageNumber,
            artifact: 'image',
            reason: runType === 'resume' ? 'resume' : 'initial',
            outputPath: toRelative(pdfId, abs),
            durationMs: avgDuration,
            metadata: { precision: 'batch_average', reason: 'pdftoppm renders pages in one batch' },
          });
          upsertPage(pdfId, pageNumber, {
            page_uid: r.pageUids[i],
            image_path: toRelative(pdfId, abs),
            status: 'rendered',
          });
          bumpProgress(pdfId, pageNumber);
        }
      }
      await persistMetadata(pdfId);
      finishStage(renderStage, 'succeeded', { pageCount, precision: isTextImport ? 'per_page_callback' : 'batch' });
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
      const textStage = startStage(run, 'extract_text', { pageCount });
      const textHandles = new Map<number, TimingArtifactHandle | null>();
      setProgress(pdfId, 'extracting_text', 0, pageCount);
      await persistMetadata(pdfId);
      const { pages } = await extractText(pdfId, pageCount, (pageNumber) => {
        const h = textHandles.get(pageNumber) ?? startArtifact({ run, pageNumber, artifact: 'text', reason: runType === 'resume' ? 'resume' : 'initial', metadata: { precision: 'callback_completion' } });
        textHandles.set(pageNumber, h);
        bumpProgress(pdfId, pageNumber);
      });
      textResult = pages;
      for (const p of pages) {
        const h = textHandles.get(p.pageNumber) ?? startArtifact({ run, pageNumber: p.pageNumber, artifact: 'text', reason: runType === 'resume' ? 'resume' : 'initial', metadata: { precision: 'post_step' } });
        finishArtifact(h, 'succeeded', { outputPath: toRelative(pdfId, p.textPath), metadata: { empty: p.empty, precision: 'callback_completion' } });
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
      finishStage(textStage, 'succeeded', { pageCount });
    } else {
      // Rebuild textResult from disk + metadata on resume.
      const existingMeta = (await readMetadata(pdfId)) ?? null;
      const resumePageRows = listPageRows(pdfId);
      textResult = [];
      for (let n = 1; n <= pageCount; n++) {
        const pr = resumePageRows.find((p) => p.page_number === n);
        const tp = pr?.text_path ? path.join(pdfDir(pdfId), pr.text_path) : pageTextPath(pdfId, pr!.page_uid);
        const empty = !!existingMeta?.pages.find((p) => p.page_number === n)?.text_empty;
        textResult.push({ pageNumber: n, empty, textPath: tp });
      }
      logger.info({ pdfId, pageCount }, 'Pipeline: reuse extracted text (resume)');
    }

    // -------- Step 2.5: PDF full-text re-split (Third Batch) --------
    // NOTE:
    // This branch rewrites source PDF paging by merging full text and asking LLM
    // to split again. In production this can collapse a multi-page PDF into a
    // single page (or otherwise drift from source pagination), which is not
    // acceptable for users expecting page-by-page processing.
    // Keep this path disabled by default; preserve original PDF page structure.
    const isTextImportForResplit = fs.existsSync(sourceTextPath(pdfId));
    const sourceType = row.source_type ?? 'pdf';
    const shouldResplitPdfFullText = false && !isTextImportForResplit && sourceType === 'pdf' && !alreadyTextDone;
    if (shouldResplitPdfFullText) {
      const fullText = (
        await Promise.all(
          textResult.map(async (t) => {
            try {
              return await fs.promises.readFile(t.textPath, 'utf8');
            } catch {
              return '';
            }
          }),
        )
      )
        .join('\n\n')
        .trim();

      const splitStage = startStage(run, 'split_text', { source_type: 'pdf_fulltext' });
      const split = await splitTextWithLlm(fullText);
      finishStage(splitStage, 'succeeded', {
        source_type: 'pdf_fulltext',
        source_pages: pageCount,
        pages: split.pages.length,
      });

      // Rebuild page artifacts from the re-split result so downstream script /
      // TTS follows the regenerated deck structure (not original PDF paging).
      await fs.promises.rm(path.join(pdfDir(pdfId), 'pages'), { recursive: true, force: true });
      db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);

      setProgress(pdfId, 'rendering', 0, split.pages.length);
      await persistMetadata(pdfId);

      const resplitPageUids = new Map(split.pages.map((p) => [p.pageNumber, nanoid(10)]));
      const textImageHandles = new Map<number, TimingArtifactHandle | null>();
      const rendered = await renderTextPagesWithLlm({
        pdfId,
        pages: split.pages.map((p) => ({ ...p, pageUid: resplitPageUids.get(p.pageNumber)! })),
        onPage: (n, imagePath, info) => {
          const h = textImageHandles.get(n) ?? startArtifact({ run, pageNumber: n, artifact: 'image', reason: runType === 'resume' ? 'resume' : 'initial', metadata: { source_type: 'pdf_fulltext', precision: 'step_timing' } });
          textImageHandles.set(n, h);
          const status = info.status ?? (info.reused ? 'skipped' : 'succeeded');
          finishArtifact(h, status, {
            startedAt: info.startedAt,
            endedAt: info.endedAt,
            durationMs: info.latencyMs,
            outputPath: status === 'failed' ? null : toRelative(pdfId, imagePath),
            error: info.error ? { code: info.error.code ?? info.error.type ?? null, message: info.error.message } : undefined,
            metadata: {
              source_type: 'pdf_fulltext',
              precision: 'step_timing',
              reused: info.reused,
              attempt: info.attempt ?? null,
              model: info.model ?? null,
              promptLength: info.promptLength ?? null,
              timeoutMs: info.timeoutMs ?? null,
              errorStatus: info.error?.status ?? null,
              errorType: info.error?.type ?? null,
              ...(info.metadata ?? {}),
            },
          });
          if (status === 'failed') {
            upsertPage(pdfId, n, {
              page_uid: resplitPageUids.get(n),
              status: 'failed',
              error_message: info.error?.message ?? 'PDF full-text image generation failed',
            });
            bumpProgress(pdfId, n);
            return;
          }
          upsertPage(pdfId, n, {
            page_uid: resplitPageUids.get(n),
            image_path: toRelative(pdfId, imagePath),
            status: 'rendered',
            error_message: null,
          });
          bumpProgress(pdfId, n);
        },
      });

      const rebuiltPageCount = rendered.pageCount;
      pageCount = rebuiltPageCount;
      updatePdf(pdfId, { page_count: rebuiltPageCount });
      setProgress(pdfId, 'extracting_text', 0, rebuiltPageCount);
      await persistMetadata(pdfId, {
        notes: 'Third Batch: rebuilt from merged full-text and regenerated slide outline/pages',
      });

      textResult = split.pages.map((p) => ({
        pageNumber: p.pageNumber,
        empty: p.content.trim().length === 0,
        textPath: pageTextPath(pdfId, resplitPageUids.get(p.pageNumber)!),
      }));

      for (const p of split.pages) {
        const pageUid = resplitPageUids.get(p.pageNumber)!;
        const textPath = pageTextPath(pdfId, pageUid);
        await fs.promises.writeFile(textPath, p.content, 'utf8');
        upsertPage(pdfId, p.pageNumber, {
          page_uid: pageUid,
          text_path: toRelative(pdfId, textPath),
          status: 'text_ready',
          error_message: null,
        });
      }

      setProgress(pdfId, 'text_extracted', rebuiltPageCount, rebuiltPageCount);
      await persistMetadata(pdfId, {
        notes: 'Third Batch: source PDF paging replaced by full-text re-split deck pages',
      });
      logger.info(
        { pdfId, sourcePages: row.page_count ?? null, rebuiltPages: rebuiltPageCount },
        'Pipeline: PDF full-text re-split complete',
      );
    }

    // Fetch the latest row to pick up user prompt / TTS settings submitted via
    // POST /api/pdfs/:id/start (may be null / empty if user skipped).
    const rowWithPrompt = getPdfRow(pdfId);
    const userPrompt = rowWithPrompt?.user_prompt ?? null;

    // -------- Step 3 (M3): generate deck title first (non-fatal) --------
    // For TXT or PDF, generate title from available extracted page text before
    // script/audio stages so UI can show a better title as early as possible.
    try {
      const titleStage = startStage(run, 'generate_title', { pageCount });
      const titleResult = await generateTitle(pdfId, pageCount, { userPrompt });
      updatePdf(pdfId, { title: titleResult.title });
      await persistMetadata(pdfId, {
        models: {
          ...((await readMetadata(pdfId))?.models ?? {}),
          llm: getRuntimeAiSettings().openaiLlmModel,
        },
        usage: {
          ...((await readMetadata(pdfId))?.usage ?? {}),
          llm_prompt_tokens_total:
            (((await readMetadata(pdfId))?.usage?.llm_prompt_tokens_total ?? 0) +
              titleResult.usage.prompt_tokens),
          llm_completion_tokens_total:
            (((await readMetadata(pdfId))?.usage?.llm_completion_tokens_total ?? 0) +
              titleResult.usage.completion_tokens),
          llm_tokens_total:
            (((await readMetadata(pdfId))?.usage?.llm_tokens_total ?? 0) +
              titleResult.usage.total_tokens),
        },
      });
      logger.info(
        {
          pdfId,
          title: titleResult.title,
          source: titleResult.source,
          usage: titleResult.usage,
        },
        'Pipeline: early title generated',
      );
      finishStage(titleStage, 'succeeded', { source: titleResult.source, usage: titleResult.usage });
    } catch (err) {
      finishStage(startStage(run, 'generate_title'), 'failed', undefined, { message: err instanceof Error ? err.message : String(err) });
      logger.warn(
        {
          pdfId,
          error: err instanceof Error ? err.message : String(err),
        },
        'Pipeline: early title generation failed (non-fatal, keeping original title)',
      );
    }

    // -------- Step 4 (M3): generate per-page script --------
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
    const scriptStage = startStage(run, 'generate_scripts', { pageCount });
    const scriptHandles = new Map<number, TimingArtifactHandle | null>();
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
    const scriptStagePageRows = listPageRows(pdfId);
    const scriptStageUidByNumber = new Map(scriptStagePageRows.map((p) => [p.page_number, p.page_uid]));
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
        imagePath: pageImagePath(pdfId, scriptStageUidByNumber.get(t.pageNumber)!),
      });
    }

    const scriptMaxCharsPerPage = rowWithPrompt?.script_max_chars_per_page ?? null;

    const scriptResult = await generateScript({
      pdfId,
      pageCount,
      pages: pagesForScript,
      userPrompt,
      maxCharsPerPage: scriptMaxCharsPerPage,
      onPage: (pageNumber, done, info) => {
        const h = scriptHandles.get(pageNumber) ?? startArtifact({ run, pageNumber, artifact: 'script', reason: runType === 'resume' ? 'resume' : 'initial', metadata: { precision: info ? 'step_timing' : 'callback_completion' } });
        scriptHandles.set(pageNumber, h);
        if (info) {
          finishArtifact(h, info.skipped ? 'skipped' : 'succeeded', {
            startedAt: info.startedAt,
            endedAt: info.endedAt,
            outputPath: toRelative(pdfId, info.scriptPath),
            metadata: { skipped: info.skipped, precision: 'step_timing' },
          });
        }
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
    finishStage(scriptStage, 'succeeded', { generated: scriptResult.pages.filter((p) => !p.skipped).length, skipped: scriptResult.pages.filter((p) => p.skipped).length });

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
    const audioStage = startStage(run, 'synthesize_audio', { pages: nonEmptyScripts.length });
    const audioHandles = new Map<number, TimingArtifactHandle | null>();
    updatePdf(pdfId, { error_message: null });
    await persistMetadata(pdfId);

    const ttsVoiceForRun = latestAfterScript?.tts_voice ?? rowWithPrompt?.tts_voice ?? null;
    const ttsSpeedForRun = latestAfterScript?.tts_speed ?? rowWithPrompt?.tts_speed ?? null;
    logger.info(
      {
        pdfId,
        ttsVoiceForRun,
        ttsSpeedForRun,
        latestTtsVoice: latestAfterScript?.tts_voice ?? null,
        latestTtsSpeed: latestAfterScript?.tts_speed ?? null,
        initialTtsVoice: rowWithPrompt?.tts_voice ?? null,
        initialTtsSpeed: rowWithPrompt?.tts_speed ?? null,
      },
      'Pipeline: TTS settings selected for this run',
    );

    const ttsResult = await synthesizeAudio({
      pdfId,
      pageCount,
      pages: nonEmptyScripts,
      voice: ttsVoiceForRun,
      speed: ttsSpeedForRun,
      onPage: (pageNumber, done, info) => {
        const h = audioHandles.get(pageNumber) ?? startArtifact({ run, pageNumber, artifact: 'audio', reason: runType === 'resume' ? 'resume' : 'initial', metadata: { precision: info ? 'step_timing' : 'callback_completion' } });
        audioHandles.set(pageNumber, h);
        if (info) {
          finishArtifact(h, info.skipped ? 'skipped' : 'succeeded', {
            startedAt: info.startedAt,
            endedAt: info.endedAt,
            outputPath: toRelative(pdfId, info.audioPath),
            metadata: { skipped: info.skipped, duration_seconds: info.durationSeconds, precision: 'step_timing' },
          });
        }
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
    const totalAudioDurationSeconds = sumAudioDurationSeconds(ttsResult.pages.map((p) => p.durationSeconds));

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
      total_audio_duration_seconds: totalAudioDurationSeconds,
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
        totalAudioDurationSeconds,
      },
      'Pipeline: M4 TTS stage complete — pdf ready',
    );
    finishStage(audioStage, 'succeeded', { generated: ttsResult.pages.filter((p) => !p.skipped).length, skipped: ttsResult.pages.filter((p) => p.skipped).length });
    const finalizeStage = startStage(run, 'finalize');
    finishStage(finalizeStage, 'succeeded');
    finishRun(run, 'succeeded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'AWAITING_SPLIT_CONFIRMATION') {
      logger.info({ pdfId }, 'Pipeline: paused for split confirmation');
      finishRun(run, 'succeeded');
      return;
    }
    logger.error({ err, pdfId }, 'Pipeline failed');
    finishRun(run, 'failed', { message });
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
 * YouTube 任務先沿用同一個佇列入口；實際流程會在後續 patch
 * 依 source_type 分流到專用 pipeline。
 */
export function enqueueYoutubeProcessing(pdfId: string): void {
  enqueuePdfProcessing(pdfId);
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
