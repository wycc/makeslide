import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { nanoid } from 'nanoid';
import { config } from '../config';
import { db } from '../db';
import { logger } from '../logger';
import { getOpenAIClient } from '../services/openai';
import {
  pageAudioPath,
  pageImagePath,
  pageScriptPath,
  readMetadata,
  safeJoinPdfPath,
  writeMetadata,
} from '../services/storage';
import type { PdfRow } from '../types';
import { generateScript } from './steps/generateScript';
import { readScriptsForTts, synthesizeAudio } from './steps/synthesizeAudio';

/**
 * 批次「重生」任務：使用者從前端一次勾選多個項目（逐字稿 / 語音 / 圖檔）後，
 * 這裡以固定順序（image → script → audio）依序執行，並將進度暴露給前端輪詢。
 *
 * 排序理由：
 *   1. 圖檔重生最耗時且與逐字稿/語音互相獨立，優先啟動可讓使用者最早看到視覺結果。
 *   2. 逐字稿變動會讓原本的語音失效，所以語音必須在逐字稿之後。
 *
 * 狀態只存在記憶體中；若伺服器重啟，前端會收到 404 並把 UI 視為「已結束」。
 * 這對本專案的情境（單機、手動觸發）已經足夠。
 */

export type RegenStepName = 'script' | 'audio' | 'image';

export type RegenStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export type RegenJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface RegenStepProgress {
  name: RegenStepName;
  status: RegenStepStatus;
  total: number;
  completed: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface RegenJobState {
  job_id: string;
  pdf_id: string;
  steps: RegenStepProgress[];
  current_step: RegenStepName | null;
  step_index: number; // 0-based index into steps
  status: RegenJobStatus;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  error: string | null;
  message: string | null;
}

export interface RegenerateOptions {
  scripts?: { prompt?: string | null } | null;
  audio?: { voice?: string | null; speed?: number | null } | null;
  images?: { prompt: string } | null;
}

const jobs = new Map<string, RegenJobState>();

function nowIso(): string {
  return new Date().toISOString();
}

function pagePad(pageCount: number): number {
  return pageCount > 999 ? 4 : 3;
}

function getPdfRowStrict(pdfId: string): PdfRow {
  const row = db
    .prepare(
      `SELECT id, title, original_filename, status, page_count, progress_step,
              progress_current, progress_total,
              error_message, user_prompt, require_script_confirmation,
              tts_voice, tts_speed, script_max_chars_per_page,
              created_at, updated_at
         FROM pdfs WHERE id = ?`,
    )
    .get(pdfId) as PdfRow | undefined;
  if (!row) {
    throw new Error('PDF_NOT_FOUND');
  }
  return row;
}

export function getRegenerateJob(pdfId: string): RegenJobState | null {
  return jobs.get(pdfId) ?? null;
}

/**
 * 建立並啟動一個重生任務。已經在跑的任務會以 `JOB_ALREADY_RUNNING` 拋錯；
 * 已完成/失敗的舊任務會被新的任務覆蓋。
 */
export function startRegenerateJob(
  pdfId: string,
  options: RegenerateOptions,
): RegenJobState {
  const existing = jobs.get(pdfId);
  if (existing && existing.status === 'running') {
    const err = new Error('JOB_ALREADY_RUNNING');
    (err as Error & { code?: string }).code = 'JOB_ALREADY_RUNNING';
    throw err;
  }

  const row = getPdfRowStrict(pdfId);
  const pageCount = row.page_count ?? 0;
  if (pageCount <= 0) {
    const err = new Error('INVALID_STATE');
    (err as Error & { code?: string }).code = 'INVALID_STATE';
    throw err;
  }

  const stepNames: RegenStepName[] = [];
  if (options.images) stepNames.push('image');
  if (options.scripts) stepNames.push('script');
  if (options.audio) stepNames.push('audio');
  if (stepNames.length === 0) {
    const err = new Error('NO_STEPS_SELECTED');
    (err as Error & { code?: string }).code = 'NO_STEPS_SELECTED';
    throw err;
  }

  const started = nowIso();
  const state: RegenJobState = {
    job_id: nanoid(10),
    pdf_id: pdfId,
    steps: stepNames.map((n) => ({
      name: n,
      status: 'pending',
      total: pageCount,
      completed: 0,
      error: null,
      started_at: null,
      finished_at: null,
    })),
    current_step: null,
    step_index: -1,
    status: 'pending',
    started_at: started,
    updated_at: started,
    finished_at: null,
    error: null,
    message: null,
  };
  jobs.set(pdfId, state);
  void runJob(state, options).catch((err) => {
    logger.error({ err, pdfId }, 'regenerate job runner rejected');
  });
  return state;
}

async function runJob(
  state: RegenJobState,
  options: RegenerateOptions,
): Promise<void> {
  state.status = 'running';
  state.updated_at = nowIso();
  logger.info(
    {
      pdfId: state.pdf_id,
      jobId: state.job_id,
      steps: state.steps.map((s) => s.name),
    },
    'regenerate job: start',
  );

  try {
    for (let i = 0; i < state.steps.length; i++) {
      const step = state.steps[i]!;
      state.current_step = step.name;
      state.step_index = i;
      step.status = 'running';
      step.started_at = nowIso();
      step.completed = 0;
      state.updated_at = nowIso();

      try {
        if (step.name === 'script') {
          await runRegenerateScripts(state, step, options.scripts ?? {});
        } else if (step.name === 'audio') {
          await runRegenerateAudio(state, step, options.audio ?? {});
        } else if (step.name === 'image') {
          await runRegenerateImages(state, step, options.images!);
        }
        step.status = 'completed';
        step.finished_at = nowIso();
      } catch (err) {
        step.status = 'failed';
        step.error = err instanceof Error ? err.message : String(err);
        step.finished_at = nowIso();
        throw err;
      } finally {
        state.updated_at = nowIso();
      }
    }

    state.current_step = null;
    state.status = 'completed';
    state.finished_at = nowIso();
    state.updated_at = nowIso();
    state.message = '重生完成';
    logger.info(
      { pdfId: state.pdf_id, jobId: state.job_id },
      'regenerate job: completed',
    );
  } catch (err) {
    state.status = 'failed';
    state.error = err instanceof Error ? err.message : String(err);
    state.finished_at = nowIso();
    state.updated_at = nowIso();
    logger.error(
      { err, pdfId: state.pdf_id, jobId: state.job_id },
      'regenerate job: failed',
    );
  }
}

// ---------------------------------------------------------------------------
// Step implementations
// ---------------------------------------------------------------------------

async function runRegenerateScripts(
  state: RegenJobState,
  step: RegenStepProgress,
  opts: { prompt?: string | null },
): Promise<void> {
  const pdfId = state.pdf_id;
  const pdfRow = getPdfRowStrict(pdfId);
  const pageCount = pdfRow.page_count ?? 0;
  if (pageCount <= 0) throw new Error('page_count 不可用');

  const pageRows = db
    .prepare(
      `SELECT page_number, text_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
    )
    .all(pdfId) as Array<{ page_number: number; text_path: string | null }>;
  step.total = pageRows.length;

  // 刪除既有腳本檔，避免 generateScript 的 idempotent skip 拿到舊內容。
  for (const p of pageRows) {
    try {
      await fs.promises.rm(pageScriptPath(pdfId, p.page_number, pageCount), {
        force: true,
      });
    } catch {
      // ignore
    }
  }

  const pages: Array<{
    pageNumber: number;
    text: string;
    empty: boolean;
    imagePath: string;
  }> = [];
  for (const p of pageRows) {
    let text = '';
    if (p.text_path) {
      try {
        text = await fs.promises.readFile(
          safeJoinPdfPath(pdfId, p.text_path),
          'utf8',
        );
      } catch {
        text = '';
      }
    }
    pages.push({
      pageNumber: p.page_number,
      text,
      empty: text.trim().length === 0,
      imagePath: pageImagePath(pdfId, p.page_number, pageCount),
    });
  }

  const userPrompt = (opts.prompt ?? pdfRow.user_prompt ?? '').toString().trim() || null;
  const scriptMaxCharsPerPage = pdfRow.script_max_chars_per_page ?? null;

  await generateScript({
    pdfId,
    pageCount,
    pages,
    userPrompt,
    maxCharsPerPage: scriptMaxCharsPerPage,
    onPage: (_pn, done) => {
      step.completed = done;
      state.updated_at = nowIso();
    },
  });

  // DB + metadata 同步
  const updatedAt = nowIso();
  const pad = pagePad(pageCount);
  for (const p of pageRows) {
    const padded = String(p.page_number).padStart(pad, '0');
    const relPath = path.posix.join('pages', `${padded}.script.txt`);
    db.prepare(
      `UPDATE pages
          SET script_path = ?,
              status = 'script_ready',
              error_message = NULL,
              updated_at = ?
        WHERE pdf_id = ? AND page_number = ?`,
    ).run(relPath, updatedAt, pdfId, p.page_number);
  }
  db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(updatedAt, pdfId);
  try {
    const meta = await readMetadata(pdfId);
    if (meta) {
      for (const p of pageRows) {
        const padded = String(p.page_number).padStart(pad, '0');
        const relPath = path.posix.join('pages', `${padded}.script.txt`);
        const mp = meta.pages.find((x) => x.page_number === p.page_number);
        if (mp) {
          mp.script = relPath;
          mp.status = 'script_ready';
          mp.script_generated_at = updatedAt;
        }
      }
      meta.updated_at = updatedAt;
      await writeMetadata(pdfId, meta);
    }
  } catch (err) {
    logger.warn(
      { err, pdfId },
      'regenerate scripts: failed to sync metadata.json (non-fatal)',
    );
  }
}

async function runRegenerateAudio(
  state: RegenJobState,
  step: RegenStepProgress,
  opts: { voice?: string | null; speed?: number | null },
): Promise<void> {
  const pdfId = state.pdf_id;
  const pdfRow = getPdfRowStrict(pdfId);
  const pageCount = pdfRow.page_count ?? 0;
  if (pageCount <= 0) throw new Error('page_count 不可用');

  // 刪除既有語音，避免 synthesizeAudio idempotent skip 拿到舊音檔。
  for (let n = 1; n <= pageCount; n++) {
    try {
      await fs.promises.rm(pageAudioPath(pdfId, n, pageCount), { force: true });
    } catch {
      // ignore
    }
  }

  const scripts = await readScriptsForTts(pdfId, pageCount);
  const nonEmpty = scripts.filter((s) => s.script.trim().length > 0);
  step.total = nonEmpty.length;
  if (nonEmpty.length === 0) {
    throw new Error('沒有可用的逐字稿，無法批次重生語音');
  }

  const voice = opts.voice ?? pdfRow.tts_voice ?? null;
  const speed = opts.speed ?? pdfRow.tts_speed ?? null;

  const res = await synthesizeAudio({
    pdfId,
    pageCount,
    pages: nonEmpty,
    voice,
    speed,
    onPage: (_pn, done) => {
      step.completed = done;
      state.updated_at = nowIso();
    },
  });

  const updatedAt = nowIso();
  const pad = pagePad(pageCount);
  for (const a of res.pages) {
    const padded = String(a.pageNumber).padStart(pad, '0');
    const relPath = path.posix.join('pages', `${padded}.mp3`);
    db.prepare(
      `UPDATE pages
          SET audio_path = ?,
              audio_duration_seconds = ?,
              status = 'audio_ready',
              error_message = NULL,
              updated_at = ?
        WHERE pdf_id = ? AND page_number = ?`,
    ).run(relPath, a.durationSeconds, updatedAt, pdfId, a.pageNumber);
  }
  db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(updatedAt, pdfId);
  try {
    const meta = await readMetadata(pdfId);
    if (meta) {
      for (const a of res.pages) {
        const padded = String(a.pageNumber).padStart(pad, '0');
        const mp = meta.pages.find((x) => x.page_number === a.pageNumber);
        if (mp) {
          mp.audio = path.posix.join('pages', `${padded}.mp3`);
          mp.audio_duration_seconds = a.durationSeconds;
          mp.audio_generated_at = updatedAt;
          mp.status = 'audio_ready';
        }
      }
      meta.updated_at = updatedAt;
      await writeMetadata(pdfId, meta);
    }
  } catch (err) {
    logger.warn(
      { err, pdfId },
      'regenerate audio: failed to sync metadata.json (non-fatal)',
    );
  }
}

async function runRegenerateImages(
  state: RegenJobState,
  step: RegenStepProgress,
  opts: { prompt: string },
): Promise<void> {
  const pdfId = state.pdf_id;
  const pdfRow = getPdfRowStrict(pdfId);
  const pageCount = pdfRow.page_count ?? 0;
  if (pageCount <= 0) throw new Error('page_count 不可用');
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error('圖檔提示詞不可為空');

  const pageRows = db
    .prepare(
      `SELECT page_number, text_path, script_path
         FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
    )
    .all(pdfId) as Array<{
    page_number: number;
    text_path: string | null;
    script_path: string | null;
  }>;
  step.total = pageRows.length;

  const client = getOpenAIClient();
  for (const p of pageRows) {
    let pageText = '';
    let pageScript = '';
    if (p.text_path) {
      try {
        pageText = await fs.promises.readFile(
          safeJoinPdfPath(pdfId, p.text_path),
          'utf8',
        );
      } catch {
        pageText = '';
      }
    }
    if (p.script_path) {
      try {
        pageScript = await fs.promises.readFile(
          safeJoinPdfPath(pdfId, p.script_path),
          'utf8',
        );
      } catch {
        pageScript = '';
      }
    }

    const mergedPrompt = [
      '請產生一張 16:9 的現代知識型簡報頁，視覺風格接近 NotebookLM（資訊圖卡、清楚層級、留白充足）。',
      '請保持全份簡報視覺風格一致。',
      `整份調整需求：\n${prompt}`,
      `本頁文字內容（參考）：\n${pageText || '(無)'}`,
      `本頁逐字稿（參考）：\n${pageScript || '(無)'}`,
    ].join('\n\n');

    const generated = await client.images.generate({
      model: config.openaiImageModel,
      prompt: mergedPrompt,
      size: '1536x1024',
    });
    const b64 = generated.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error(
        `OpenAI generate returned empty result at page ${p.page_number}`,
      );
    }
    const newBuf = Buffer.from(b64, 'base64');
    await sharp(newBuf)
      .resize(1920, 1080, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255 },
      })
      .png()
      .toFile(pageImagePath(pdfId, p.page_number, pageCount));

    step.completed += 1;
    state.updated_at = nowIso();
  }

  const updatedAt = nowIso();
  db.prepare(`UPDATE pages SET updated_at = ? WHERE pdf_id = ?`).run(updatedAt, pdfId);
  db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(updatedAt, pdfId);
  try {
    const meta = await readMetadata(pdfId);
    if (meta) {
      meta.updated_at = updatedAt;
      await writeMetadata(pdfId, meta);
    }
  } catch (err) {
    logger.warn(
      { err, pdfId },
      'regenerate images: failed to sync metadata.json (non-fatal)',
    );
  }
}
