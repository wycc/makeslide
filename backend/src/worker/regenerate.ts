import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { toFile } from 'openai';
import { generatePageThumbnail } from '../services/thumbnails';
import { nanoid } from 'nanoid';
import { config } from '../config';
import { db } from '../db';
import { logger } from '../logger';
import { getOpenAIClient } from '../services/openai';
import { buildImagePrompt, IMAGE_PROMPT_TEMPLATES } from '../services/imagePromptTemplates';
import { loadPromptTemplate, renderPromptTemplate } from '../services/promptTemplates';
import {
  pageAudioPath,
  pageImagePath,
  pageScriptPath,
  pdfDir,
  readMetadata,
  safeJoinPdfPath,
  writeMetadata,
} from '../services/storage';
import type { PageStatus, PdfRow } from '../types';
import { generateScript } from './steps/generateScript';
import { readScriptsForTts, synthesizeAudio } from './steps/synthesizeAudio';
import {
  finishArtifact,
  finishRun,
  finishStage,
  startArtifact,
  startRun,
  startStage,
  type TimingRunContext,
} from '../services/timing';

/**
 * 批次「重生」任務：使用者從前端一次勾選多個項目（逐字稿 / 語音 / 圖檔）後，
 * 這裡以固定順序（image → script → audio）依序執行，並將進度暴露給前端輪詢。
 *
 * 排序理由：
 *   1. 圖檔重生最耗時且與逐字稿/語音互相獨立，優先啟動可讓使用者最早看到視覺結果。
 *   2. 逐字稿變動會讓原本的語音失效，所以語音必須在逐字稿之後。
 *
 * 狀態會同步持久化到 regenerate_jobs 資料表；若伺服器重啟，
 * 前端仍可查到最後一次任務狀態與 rollback 可用性。
 *
 * Snapshot / rollback：
 *   啟動任務前，對每個頁面的三種資產（image/script/audio）做一份磁碟快照並
 *   記錄每個檔案「原本是否存在」；rollback 時覆蓋或刪除以回到啟動前的狀態。
 *   對應的 pages 表欄位（status / image_path / script_path / audio_path /
 *   audio_duration_seconds）也會一併快照，rollback 時寫回。
 */

export type RegenStepName = 'script' | 'audio' | 'image';

export type RegenStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type RegenJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

export interface RegenStepProgress {
  name: RegenStepName;
  status: RegenStepStatus;
  total: number;
  completed: number;
  eta_seconds: number | null;
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
  // NEW: 取消請求與進度指標
  cancel_requested: boolean;
  last_processed_page: number | null;
  last_generated_page: number | null;
  eta_seconds: number | null;
  estimated_completion_at: string | null;
  // NEW: 快照與還原
  snapshot_id: string | null;
  rollback_available: boolean;
  timing_run_id?: string | null;
}

export interface RegenerateOptions {
  scripts?: { prompt?: string | null; script_max_chars_per_page?: number | null } | null;
  audio?: { voice?: string | null; speed?: number | null } | null;
  images?: { prompt: string } | null;
}

const jobs = new Map<string, RegenJobState>();

const EDIT_SLIDE_IMAGE_PROMPT_FALLBACK = [
  'You are editing an existing presentation slide image provided as the input image.',
  'Use the uploaded image as the strict visual source of truth.',
  'Preserve the original slide layout, composition, colors, typography style, relative object positions, diagrams, icons, and readable text unless the user explicitly asks to change those specific elements.',
  'Only make the minimal edits required by the user adjustment prompt. Do not redesign the slide, do not invent unrelated visual elements, and do not change the overall style beyond the requested modification.',
  'If the request is ambiguous, prefer conservative local edits and keep the original image as unchanged as possible.',
  '',
  '{{base_prompt}}',
].join('\n');

function nowIso(): string {
  return new Date().toISOString();
}

function pagePadFor(pageCount: number): number {
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

function cloneJobState(state: RegenJobState): RegenJobState {
  return JSON.parse(JSON.stringify(state)) as RegenJobState;
}

function persistRegenerateJob(state: RegenJobState): void {
  const snapshot = cloneJobState(state);
  db.prepare(
    `INSERT INTO regenerate_jobs (
        pdf_id, job_id, state_json, status, started_at, updated_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pdf_id) DO UPDATE SET
        job_id = excluded.job_id,
        state_json = excluded.state_json,
        status = excluded.status,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        finished_at = excluded.finished_at`,
  ).run(
    snapshot.pdf_id,
    snapshot.job_id,
    JSON.stringify(snapshot),
    snapshot.status,
    snapshot.started_at,
    snapshot.updated_at,
    snapshot.finished_at,
  );
}

function readPersistedRegenerateJob(pdfId: string): RegenJobState | null {
  const row = db
    .prepare(`SELECT state_json FROM regenerate_jobs WHERE pdf_id = ?`)
    .get(pdfId) as { state_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.state_json) as RegenJobState;
  } catch (err) {
    logger.warn({ err, pdfId }, 'regenerate job: failed to parse persisted state');
    return null;
  }
}

function setStateUpdated(state: RegenJobState, updatedAt = nowIso()): void {
  state.updated_at = updatedAt;
  persistRegenerateJob(state);
}

function calculateStepEtaSeconds(step: RegenStepProgress, nowMs = Date.now()): number | null {
  if (!step.started_at || step.total <= 0 || step.completed <= 0 || step.completed >= step.total) {
    return null;
  }
  const startedMs = Date.parse(step.started_at);
  if (!Number.isFinite(startedMs) || nowMs <= startedMs) return null;
  const elapsedSeconds = (nowMs - startedMs) / 1000;
  const secondsPerUnit = elapsedSeconds / step.completed;
  return Math.max(1, Math.ceil(secondsPerUnit * (step.total - step.completed)));
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

function refreshJobEta(state: RegenJobState, nowMs = Date.now()): void {
  for (const step of state.steps) {
    step.eta_seconds = step.status === 'running' ? calculateStepEtaSeconds(step, nowMs) : null;
  }

  const currentStep = state.steps.find((step) => step.status === 'running') ?? null;
  const currentEta = currentStep?.eta_seconds ?? null;
  state.eta_seconds = currentEta;
  state.estimated_completion_at =
    currentEta != null ? new Date(nowMs + currentEta * 1000).toISOString() : null;
}

function updateStateProgress(state: RegenJobState, updatedAt = nowIso()): void {
  refreshJobEta(state, Date.parse(updatedAt));
  setStateUpdated(state, updatedAt);
}

export function getRegenerateJob(pdfId: string): RegenJobState | null {
  const inMemory = jobs.get(pdfId);
  if (inMemory) return inMemory;
  const persisted = readPersistedRegenerateJob(pdfId);
  if (!persisted) return null;
  // 重啟後沒有背景 runner 可繼續進行；將未完成狀態標示為失敗，避免 UI 無限等待。
  if (
    persisted.status === 'pending' ||
    persisted.status === 'running' ||
    persisted.status === 'cancelling'
  ) {
    persisted.status = 'failed';
    persisted.error = '伺服器重啟，重生任務已中斷';
    persisted.message = persisted.rollback_available
      ? '伺服器重啟導致任務中斷，可按「還原」回復到重生前狀態'
      : '伺服器重啟導致任務中斷';
    persisted.finished_at = nowIso();
    setStateUpdated(persisted, persisted.finished_at);
  }
  jobs.set(pdfId, persisted);
  return persisted;
}

// ---------------------------------------------------------------------------
// Snapshot / rollback
// ---------------------------------------------------------------------------

const SNAPSHOT_DIR_NAME = '.regenerate-snapshot';

interface SnapshotAssetEntry {
  existed: boolean;
}

interface SnapshotPageEntry {
  page_number: number;
  db_status: PageStatus;
  db_image_path: string | null;
  db_script_path: string | null;
  db_audio_path: string | null;
  db_audio_duration_seconds: number | null;
  image?: SnapshotAssetEntry;
  script?: SnapshotAssetEntry;
  audio?: SnapshotAssetEntry;
}

interface SnapshotManifest {
  snapshot_id: string;
  created_at: string;
  pdf_id: string;
  page_count: number;
  asset_types: RegenStepName[];
  pages: SnapshotPageEntry[];
}

function snapshotDirOf(pdfId: string): string {
  return path.join(pdfDir(pdfId), SNAPSHOT_DIR_NAME);
}

function snapshotPagesDirOf(pdfId: string): string {
  return path.join(snapshotDirOf(pdfId), 'pages');
}

function snapshotManifestPathOf(pdfId: string): string {
  return path.join(snapshotDirOf(pdfId), 'manifest.json');
}

function snapshotBackupFilePath(
  pdfId: string,
  pageNumber: number,
  pageCount: number,
  assetType: RegenStepName,
): string {
  const padded = String(pageNumber).padStart(pagePadFor(pageCount), '0');
  const ext =
    assetType === 'image' ? '.png' : assetType === 'script' ? '.script.txt' : '.m4a';
  return path.join(snapshotPagesDirOf(pdfId), `${padded}${ext}`);
}

function targetFilePath(
  pdfId: string,
  pageNumber: number,
  pageCount: number,
  assetType: RegenStepName,
): string {
  if (assetType === 'image') return pageImagePath(pdfId, pageNumber, pageCount);
  if (assetType === 'script') return pageScriptPath(pdfId, pageNumber, pageCount);
  return pageAudioPath(pdfId, pageNumber, pageCount);
}

/**
 * 依照欲重生的資產類型為每一頁建立磁碟快照並記錄 pages 表當下的欄位值，
 * 以供 rollback 時復原（包含「原本不存在」的檔案也會被還原為不存在）。
 */
async function createSnapshot(
  pdfId: string,
  pageCount: number,
  assetTypes: RegenStepName[],
): Promise<SnapshotManifest> {
  const snapshotId = nanoid(10);
  const snapDir = snapshotDirOf(pdfId);
  const snapPagesDir = snapshotPagesDirOf(pdfId);
  await fs.promises.rm(snapDir, { recursive: true, force: true });
  await fs.promises.mkdir(snapPagesDir, { recursive: true });

  const pageRows = db
    .prepare(
      `SELECT page_number, status, image_path, script_path, audio_path, audio_duration_seconds
         FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
    )
    .all(pdfId) as Array<{
    page_number: number;
    status: PageStatus;
    image_path: string | null;
    script_path: string | null;
    audio_path: string | null;
    audio_duration_seconds: number | null;
  }>;

  const entries: SnapshotPageEntry[] = [];
  for (const row of pageRows) {
    const entry: SnapshotPageEntry = {
      page_number: row.page_number,
      db_status: row.status,
      db_image_path: row.image_path,
      db_script_path: row.script_path,
      db_audio_path: row.audio_path,
      db_audio_duration_seconds: row.audio_duration_seconds,
    };
    for (const assetType of assetTypes) {
      const src = targetFilePath(pdfId, row.page_number, pageCount, assetType);
      let existed = false;
      try {
        await fs.promises.access(src, fs.constants.F_OK);
        existed = true;
      } catch {
        existed = false;
      }
      if (existed) {
        const dest = snapshotBackupFilePath(pdfId, row.page_number, pageCount, assetType);
        await fs.promises.copyFile(src, dest);
      }
      entry[assetType] = { existed };
    }
    entries.push(entry);
  }

  const manifest: SnapshotManifest = {
    snapshot_id: snapshotId,
    created_at: nowIso(),
    pdf_id: pdfId,
    page_count: pageCount,
    asset_types: assetTypes,
    pages: entries,
  };
  await fs.promises.writeFile(
    snapshotManifestPathOf(pdfId),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  logger.info(
    {
      pdfId,
      snapshotId,
      pageCount,
      assetTypes,
      pages: entries.length,
    },
    'regenerate snapshot: created',
  );
  return manifest;
}

async function readSnapshotManifest(pdfId: string): Promise<SnapshotManifest | null> {
  try {
    const raw = await fs.promises.readFile(snapshotManifestPathOf(pdfId), 'utf8');
    return JSON.parse(raw) as SnapshotManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function deleteSnapshot(pdfId: string): Promise<void> {
  const snapDir = snapshotDirOf(pdfId);
  await fs.promises.rm(snapDir, { recursive: true, force: true });
}

export async function rollbackRegenerate(pdfId: string): Promise<{
  rolled_back_pages: number;
  asset_types: RegenStepName[];
  snapshot_id: string;
}> {
  const manifest = await readSnapshotManifest(pdfId);
  if (!manifest) {
    const err = new Error('SNAPSHOT_NOT_FOUND');
    (err as Error & { code?: string }).code = 'SNAPSHOT_NOT_FOUND';
    throw err;
  }

  // 若任務仍在執行中（含 cancelling），不允許 rollback 以免與背景寫入衝突。
  const existing = jobs.get(pdfId) ?? readPersistedRegenerateJob(pdfId);
  if (
    existing &&
    (existing.status === 'running' ||
      existing.status === 'pending' ||
      existing.status === 'cancelling')
  ) {
    const err = new Error('JOB_STILL_RUNNING');
    (err as Error & { code?: string }).code = 'JOB_STILL_RUNNING';
    throw err;
  }

  const updatedAt = nowIso();
  const pageCount = manifest.page_count;

  // 先還原所有磁碟檔案；任一步驟失敗就拋錯（保留 snapshot 以便重試）。
  for (const entry of manifest.pages) {
    for (const assetType of manifest.asset_types) {
      const target = targetFilePath(pdfId, entry.page_number, pageCount, assetType);
      const snap = snapshotBackupFilePath(pdfId, entry.page_number, pageCount, assetType);
      const assetEntry = entry[assetType];
      if (!assetEntry) continue;
      if (assetEntry.existed) {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.copyFile(snap, target);
      } else {
        // 原本不存在 → 若目前有檔案就刪掉。
        await fs.promises.rm(target, { force: true });
      }
    }
  }

  // 再還原 DB 欄位。
  const updateStmt = db.prepare(
    `UPDATE pages
        SET status = ?,
            image_path = ?,
            script_path = ?,
            audio_path = ?,
            audio_duration_seconds = ?,
            error_message = NULL,
            updated_at = ?
      WHERE pdf_id = ? AND page_number = ?`,
  );
  const tx = db.transaction(() => {
    for (const entry of manifest.pages) {
      updateStmt.run(
        entry.db_status,
        entry.db_image_path,
        entry.db_script_path,
        entry.db_audio_path,
        entry.db_audio_duration_seconds,
        updatedAt,
        pdfId,
        entry.page_number,
      );
    }
    db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(updatedAt, pdfId);
  });
  tx();

  // metadata.json 盡力同步，失敗只記 log。
  try {
    const meta = await readMetadata(pdfId);
    if (meta) {
      for (const entry of manifest.pages) {
        const mp = meta.pages.find((x) => x.page_number === entry.page_number);
        if (mp) {
          mp.status = entry.db_status;
          mp.image = entry.db_image_path;
          mp.script = entry.db_script_path ?? null;
          mp.audio = entry.db_audio_path ?? null;
          mp.audio_duration_seconds = entry.db_audio_duration_seconds ?? null;
        }
      }
      meta.updated_at = updatedAt;
      await writeMetadata(pdfId, meta);
    }
  } catch (err) {
    logger.warn({ err, pdfId }, 'rollbackRegenerate: failed to sync metadata.json');
  }

  await deleteSnapshot(pdfId);

  // 若記憶體中仍有 job 紀錄，將 rollback 狀態關閉。
  const job = jobs.get(pdfId) ?? readPersistedRegenerateJob(pdfId);
  if (job) {
    job.rollback_available = false;
    job.snapshot_id = null;
    job.message = '已還原至重生前狀態';
    setStateUpdated(job, updatedAt);
    jobs.set(pdfId, job);
  }

  logger.info(
    {
      pdfId,
      snapshotId: manifest.snapshot_id,
      pages: manifest.pages.length,
      assetTypes: manifest.asset_types,
    },
    'regenerate rollback: done',
  );

  return {
    rolled_back_pages: manifest.pages.length,
    asset_types: manifest.asset_types,
    snapshot_id: manifest.snapshot_id,
  };
}

/**
 * 送出取消請求（不會同步終止任務，會在下一個安全檢查點返回）。
 */
export function requestCancelRegenerateJob(pdfId: string): RegenJobState {
  const state = jobs.get(pdfId) ?? readPersistedRegenerateJob(pdfId);
  if (!state) {
    const err = new Error('JOB_NOT_FOUND');
    (err as Error & { code?: string }).code = 'JOB_NOT_FOUND';
    throw err;
  }
  if (
    state.status !== 'running' &&
    state.status !== 'pending' &&
    state.status !== 'cancelling'
  ) {
    const err = new Error('JOB_NOT_ACTIVE');
    (err as Error & { code?: string }).code = 'JOB_NOT_ACTIVE';
    throw err;
  }
  state.cancel_requested = true;
  if (state.status === 'pending' || state.status === 'running') {
    state.status = 'cancelling';
  }
  state.message = state.current_step
    ? '已送出停止請求，等待目前處理中的頁面完成'
    : '已送出停止請求，等待任務進入安全停止點';
  setStateUpdated(state);
  jobs.set(pdfId, state);
  logger.info(
    { pdfId, jobId: state.job_id, currentStep: state.current_step },
    'regenerate job: cancel requested',
  );
  return state;
}

function finalizeCancelledJob(state: RegenJobState, message: string): void {
  const finishedAt = nowIso();
  state.status = 'cancelled';
  state.error = null;
  state.message = message;
  state.current_step = null;
  state.finished_at = finishedAt;
  for (const step of state.steps) {
    if (step.status === 'running') {
      step.status = 'cancelled';
      step.error = null;
      step.finished_at = step.finished_at ?? finishedAt;
    } else if (step.status === 'pending') {
      step.status = 'skipped';
      step.error = null;
      step.finished_at = finishedAt;
    }
  }
  setStateUpdated(state, finishedAt);
}

// ---------------------------------------------------------------------------
// Job orchestration
// ---------------------------------------------------------------------------

/**
 * 建立並啟動一個重生任務。已經在跑的任務會以 `JOB_ALREADY_RUNNING` 拋錯；
 * 已完成/失敗的舊任務會被新的任務覆蓋。
 */
export function startRegenerateJob(
  pdfId: string,
  options: RegenerateOptions,
): RegenJobState {
  const existing = jobs.get(pdfId) ?? readPersistedRegenerateJob(pdfId);
  if (
    existing &&
    (existing.status === 'running' ||
      existing.status === 'pending' ||
      existing.status === 'cancelling')
  ) {
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
      eta_seconds: null,
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
    cancel_requested: false,
    last_processed_page: null,
    last_generated_page: null,
    eta_seconds: null,
    estimated_completion_at: null,
    snapshot_id: null,
    rollback_available: false,
    timing_run_id: null,
  };
  jobs.set(pdfId, state);
  persistRegenerateJob(state);
  void runJob(state, options, stepNames, pageCount).catch((err) => {
    logger.error({ err, pdfId }, 'regenerate job runner rejected');
  });
  return state;
}

async function runJob(
  state: RegenJobState,
  options: RegenerateOptions,
  stepNames: RegenStepName[],
  pageCount: number,
): Promise<void> {
  // 先建立快照（在任何寫入前），確保可回復到啟動前狀態。
  try {
    const manifest = await createSnapshot(state.pdf_id, pageCount, stepNames);
    state.snapshot_id = manifest.snapshot_id;
    state.rollback_available = true;
    setStateUpdated(state);
  } catch (err) {
    state.status = 'failed';
    state.error = `snapshot failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
    state.finished_at = nowIso();
    setStateUpdated(state);
    logger.error({ err, pdfId: state.pdf_id }, 'regenerate job: snapshot failed');
    return;
  }

  if (state.cancel_requested) {
    finalizeCancelledJob(state, '已取消（尚未開始執行）');
    return;
  }

  state.status = 'running';
  const timingRun = startRun({
    pdfId: state.pdf_id,
    runType: stepNames.length === 1 ? 'regenerate_artifact' : 'regenerate_batch',
    triggeredBy: 'user',
    metadata: { job_id: state.job_id, steps: stepNames },
  });
  state.timing_run_id = timingRun?.runId ?? null;
  setStateUpdated(state);
  logger.info(
    {
      pdfId: state.pdf_id,
      jobId: state.job_id,
      steps: state.steps.map((s) => s.name),
    },
    'regenerate job: start',
  );

  const shouldAbort = (): boolean => state.cancel_requested;

  try {
    for (let i = 0; i < state.steps.length; i++) {
      if (state.cancel_requested) {
        throw makeCancelledError();
      }
      const step = state.steps[i]!;
      state.current_step = step.name;
      state.step_index = i;
      step.status = 'running';
      step.started_at = nowIso();
      step.completed = 0;
      updateStateProgress(state);

      try {
        const timingStage = startStage(
          timingRun,
          step.name === 'script' ? 'generate_scripts' : step.name === 'audio' ? 'synthesize_audio' : 'render_pages',
          { job_id: state.job_id, regenerate: true },
        );
        if (step.name === 'script') {
          await runRegenerateScripts(state, step, options.scripts ?? {}, shouldAbort, timingRun);
        } else if (step.name === 'audio') {
          await runRegenerateAudio(state, step, options.audio ?? {}, shouldAbort, timingRun);
        } else if (step.name === 'image') {
          await runRegenerateImages(state, step, options.images!, shouldAbort, timingRun);
        }
        finishStage(timingStage, 'succeeded', { completed: step.completed, total: step.total });
        step.status = 'completed';
        step.eta_seconds = null;
        step.finished_at = nowIso();
      } catch (err) {
        const code = (err as Error & { code?: string }).code;
        if (code === 'CANCELLED' || state.cancel_requested) {
          step.status = 'cancelled';
          step.error = null;
          step.eta_seconds = null;
          step.finished_at = nowIso();
          throw makeCancelledError();
        }
        step.status = 'failed';
        step.error = err instanceof Error ? err.message : String(err);
        step.eta_seconds = null;
        step.finished_at = nowIso();
        finishStage(
          startStage(
            timingRun,
            step.name === 'script' ? 'generate_scripts' : step.name === 'audio' ? 'synthesize_audio' : 'render_pages',
            { job_id: state.job_id, regenerate: true, failed_before_stage_handle: true },
          ),
          'failed',
          undefined,
          { message: step.error },
        );
        throw err;
      } finally {
        setStateUpdated(state);
      }
    }

    state.current_step = null;
    state.status = 'completed';
    state.eta_seconds = null;
    state.estimated_completion_at = null;
    state.finished_at = nowIso();
    state.message = '重生完成';
    setStateUpdated(state);
    logger.info(
      { pdfId: state.pdf_id, jobId: state.job_id },
      'regenerate job: completed',
    );
    finishRun(timingRun, 'succeeded');
  } catch (err) {
    const code = (err as Error & { code?: string }).code;
    const wasCancelled = code === 'CANCELLED' || state.cancel_requested;
    if (wasCancelled) {
      finalizeCancelledJob(state, '已停止，可按「還原」回復到重生前狀態');
    } else {
      state.status = 'failed';
      state.error = err instanceof Error ? err.message : String(err);
      logger.error(
        { err, pdfId: state.pdf_id, jobId: state.job_id },
        'regenerate job: failed',
      );
    }
    finishRun(timingRun, wasCancelled ? 'canceled' : 'failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    if (!wasCancelled) {
      state.finished_at = nowIso();
      setStateUpdated(state);
    }
  }
}

function makeCancelledError(): Error {
  const err = new Error('CANCELLED');
  (err as Error & { code?: string }).code = 'CANCELLED';
  return err;
}

function markPageProgress(
  state: RegenJobState,
  pageNumber: number,
  done: number,
  step: RegenStepProgress,
): void {
  step.completed = done;
  state.last_processed_page = pageNumber;
  state.last_generated_page = pageNumber;
  updateStateProgress(state);
}

function isRetryableOpenAIError(err: unknown): boolean {
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

async function withExponentialBackoffRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    factor: number;
    shouldAbort?: () => boolean;
    context?: Record<string, unknown>;
  },
): Promise<T> {
  let attempt = 0;
  let delayMs = options.initialDelayMs;

  while (true) {
    if (options.shouldAbort?.()) {
      throw makeCancelledError();
    }

    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const retryable = isRetryableOpenAIError(err);
      const hasMore = attempt < options.maxAttempts;
      if (!retryable || !hasMore) {
        throw err;
      }

      logger.warn(
        {
          err,
          attempt,
          nextDelayMs: delayMs,
          ...options.context,
        },
        'openai request failed, retry with exponential backoff',
      );

      await sleep(delayMs);
      delayMs = Math.min(Math.floor(delayMs * options.factor), options.maxDelayMs);
    }
  }
}

// ---------------------------------------------------------------------------
// Step implementations
// ---------------------------------------------------------------------------

async function runRegenerateScripts(
  state: RegenJobState,
  step: RegenStepProgress,
  opts: { prompt?: string | null; script_max_chars_per_page?: number | null },
  shouldAbort: () => boolean,
  timingRun: TimingRunContext | null,
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
  const imageQuality = config.openaiImageQuality;
  const imageTimeoutMs =
    imageQuality === 'high' || imageQuality === 'medium'
      ? config.openaiImageTimeoutMsHighQuality
      : config.openaiImageTimeoutMs;

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
  const scriptMaxCharsPerPage =
    typeof opts.script_max_chars_per_page === 'number'
      ? opts.script_max_chars_per_page
      : (pdfRow.script_max_chars_per_page ?? null);

  await generateScript({
    pdfId,
    pageCount,
    pages,
    userPrompt,
    maxCharsPerPage: scriptMaxCharsPerPage,
    onPage: (pn, done, info) => {
      if (info) {
        const h = startArtifact({
          run: timingRun,
          pageNumber: pn,
          artifact: 'script',
          reason: 'regenerate',
          metadata: { job_id: state.job_id, precision: 'step_timing' },
        });
        finishArtifact(h, info.skipped ? 'skipped' : 'succeeded', {
          startedAt: info.startedAt,
          endedAt: info.endedAt,
          outputPath: path.relative(pdfDir(pdfId), info.scriptPath),
          metadata: { job_id: state.job_id, skipped: info.skipped, precision: 'step_timing' },
        });
      }
      markPageProgress(state, pn, done, step);
    },
    shouldAbort,
  });

  // DB + metadata 同步
  const updatedAt = nowIso();
  const pad = pagePadFor(pageCount);
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
  shouldAbort: () => boolean,
  timingRun: TimingRunContext | null,
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
    onPage: (pn, done, info) => {
      if (info) {
        const h = startArtifact({
          run: timingRun,
          pageNumber: pn,
          artifact: 'audio',
          reason: 'regenerate',
          metadata: { job_id: state.job_id, precision: 'step_timing' },
        });
        finishArtifact(h, info.skipped ? 'skipped' : 'succeeded', {
          startedAt: info.startedAt,
          endedAt: info.endedAt,
          outputPath: path.relative(pdfDir(pdfId), info.audioPath),
          metadata: { job_id: state.job_id, skipped: info.skipped, duration_seconds: info.durationSeconds, precision: 'step_timing' },
        });
      }
      markPageProgress(state, pn, done, step);
    },
    shouldAbort,
  });

  const updatedAt = nowIso();
  const pad = pagePadFor(pageCount);
  for (const a of res.pages) {
    const padded = String(a.pageNumber).padStart(pad, '0');
    const relPath = path.posix.join('pages', `${padded}.m4a`);
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
  const durationRows = db
    .prepare(`SELECT audio_duration_seconds FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(pdfId) as Array<{ audio_duration_seconds: number | null }>;
  const totalAudioDurationSeconds = sumAudioDurationSeconds(durationRows.map((row) => row.audio_duration_seconds));
  db.prepare(`UPDATE pdfs SET total_audio_duration_seconds = ?, updated_at = ? WHERE id = ?`).run(
    totalAudioDurationSeconds,
    updatedAt,
    pdfId,
  );
  try {
    const meta = await readMetadata(pdfId);
    if (meta) {
      meta.total_audio_duration_seconds = totalAudioDurationSeconds;
      for (const a of res.pages) {
        const padded = String(a.pageNumber).padStart(pad, '0');
        const mp = meta.pages.find((x) => x.page_number === a.pageNumber);
        if (mp) {
          mp.audio = path.posix.join('pages', `${padded}.m4a`);
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
  shouldAbort: () => boolean,
  timingRun: TimingRunContext | null,
): Promise<void> {
  const pdfId = state.pdf_id;
  const pdfRow = getPdfRowStrict(pdfId);
  const deckStylePrompt = pdfRow.image_style_prompt?.trim() || IMAGE_PROMPT_TEMPLATES[0]?.prompt_en;
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
  const imageQuality = config.openaiImageQuality;
  const imageTimeoutMs =
    imageQuality === 'high' || imageQuality === 'medium'
      ? config.openaiImageTimeoutMsHighQuality
      : config.openaiImageTimeoutMs;

  const client = getOpenAIClient();
  for (const p of pageRows) {
    if (shouldAbort()) {
      throw makeCancelledError();
    }
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

    const basePrompt = buildImagePrompt({
      stylePrompt: deckStylePrompt,
      pageText,
      pageScript,
      userAdjustmentPrompt: `Current user adjustment request:\n${prompt}`,
    });
    const editPrompt = renderPromptTemplate(
      loadPromptTemplate('backend/prompts/edit-slide-image.md', EDIT_SLIDE_IMAGE_PROMPT_FALLBACK),
      { base_prompt: basePrompt },
    );

    const currentImagePath = pageImagePath(pdfId, p.page_number, pageCount);
    const currentImageBuffer = await fs.promises.readFile(currentImagePath);
    const currentImageForEdit = await toFile(currentImageBuffer, `page-${p.page_number}.jpg`, { type: 'image/jpeg' });

    const artifactHandle = startArtifact({
      run: timingRun,
      pageNumber: p.page_number,
      artifact: 'image',
      reason: 'regenerate',
      metadata: { job_id: state.job_id, precision: 'inline' },
    });
    const generated = await withExponentialBackoffRetry(
      () =>
        client.images.edit({
          model: config.openaiImageModel,
          image: currentImageForEdit,
          prompt: editPrompt,
          size: '1536x1024',
          quality: 'low',
        }, {
          timeout: imageTimeoutMs,
        }),
      {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 15000,
        factor: 2,
        shouldAbort,
        context: {
          pdfId,
          pageNumber: p.page_number,
          jobId: state.job_id,
        },
      },
    );
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
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(pageImagePath(pdfId, p.page_number, pageCount));
    await generatePageThumbnail(pdfId, p.page_number, pageCount, pageImagePath(pdfId, p.page_number, pageCount));

    finishArtifact(artifactHandle, 'succeeded', {
      outputPath: path.posix.join('pages', `${String(p.page_number).padStart(pagePadFor(pageCount), '0')}.jpg`),
      metadata: { job_id: state.job_id, precision: 'inline' },
    });

    markPageProgress(state, p.page_number, step.completed + 1, step);
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
