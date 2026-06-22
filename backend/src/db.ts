import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import Database from 'better-sqlite3';
import { config } from './config';
import { logger } from './logger';
import { PDF_STATUSES, PAGE_STATUSES } from './statusMachine';

// Ensure the DB directory exists before opening it. This module is reached via a
// static `import { db } from './db'` in server.ts, which (per the ES module spec)
// is resolved and executed before any of server.ts's own top-level code — including
// the `ensureWorkspaceRuntimePaths()` call inside `startServer()` that this codebase
// previously relied on to create the directory first. That ordering assumption never
// actually held (the static import always wins the race), so on a fresh checkout/volume
// where `data/` doesn't exist yet, `new Database(config.dbPath)` below throws an
// uncaught "Cannot open database because the directory does not exist" error before
// `startServer()`'s try/catch (in main()) ever gets a chance to run — crashing the
// process before any logging happens. Production Docker deployments only avoided this
// because the container CMD happens to `mkdir -p` the data dir before invoking node at
// all (see Dockerfile), masking the bug. Restoring this self-contained mkdir removes the
// dependency on that external ordering entirely.
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

interface ColumnInfoRow {
  name: string;
}

function tableExists(name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { name: string } | undefined;
  return !!row;
}

function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfoRow[];
  return rows.some((r) => r.name === column);
}

function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pdfs (
      id TEXT PRIMARY KEY,
      title TEXT,
      original_filename TEXT NOT NULL,
      status TEXT NOT NULL,
      page_count INTEGER,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pdfs_created ON pdfs(created_at DESC);
  `);

  // M2 migrations on pdfs: add progress_step column if missing
  if (!columnExists('pdfs', 'progress_step')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN progress_step TEXT`);
    logger.info('Added column pdfs.progress_step');
  }

  // Progress counters per step (e.g. current=3, total=10 for "3/10").
  if (!columnExists('pdfs', 'progress_current')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN progress_current INTEGER`);
    logger.info('Added column pdfs.progress_current');
  }
  if (!columnExists('pdfs', 'progress_total')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN progress_total INTEGER`);
    logger.info('Added column pdfs.progress_total');
  }

  // M3.5: per-PDF user prompt (style / tone hint) collected right after
  // upload. Nullable + free-form; feeds both script and title generation.
  if (!columnExists('pdfs', 'user_prompt')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN user_prompt TEXT`);
    logger.info('Added column pdfs.user_prompt');
  }

  if (!columnExists('pdfs', 'require_script_confirmation')) {
    db.exec(
      `ALTER TABLE pdfs ADD COLUMN require_script_confirmation INTEGER NOT NULL DEFAULT 0`,
    );
    logger.info('Added column pdfs.require_script_confirmation');
  }

  if (!columnExists('pdfs', 'require_split_confirmation')) {
    db.exec(
      `ALTER TABLE pdfs ADD COLUMN require_split_confirmation INTEGER NOT NULL DEFAULT 0`,
    );
    logger.info('Added column pdfs.require_split_confirmation');
  }

  if (!columnExists('pdfs', 'tts_voice')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN tts_voice TEXT`);
    logger.info('Added column pdfs.tts_voice');
  }
  if (!columnExists('pdfs', 'host_mode')) {
    // 'solo' = 單人旁白；'dual' = 雙主持人對話。預設單人最穩定。
    db.exec(`ALTER TABLE pdfs ADD COLUMN host_mode TEXT NOT NULL DEFAULT 'solo'`);
    logger.info('Added column pdfs.host_mode');
  }
  if (!columnExists('pdfs', 'tts_speed')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN tts_speed REAL`);
    logger.info('Added column pdfs.tts_speed');
  }
  if (!columnExists('pdfs', 'script_max_chars_per_page')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN script_max_chars_per_page INTEGER`);
    logger.info('Added column pdfs.script_max_chars_per_page');
  }
  if (!columnExists('pdfs', 'image_style_prompt')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN image_style_prompt TEXT`);
    logger.info('Added column pdfs.image_style_prompt');
  }
  if (!columnExists('pdfs', 'source_type')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'pdf'`);
    logger.info('Added column pdfs.source_type');
  }
  if (!columnExists('pdfs', 'source_url')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN source_url TEXT`);
    logger.info('Added column pdfs.source_url');
  }
  if (!columnExists('pdfs', 'source_video_id')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN source_video_id TEXT`);
    logger.info('Added column pdfs.source_video_id');
  }
  if (!columnExists('pdfs', 'source_caption_language')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN source_caption_language TEXT`);
    logger.info('Added column pdfs.source_caption_language');
  }
  if (!columnExists('pdfs', 'category')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN category TEXT NOT NULL DEFAULT 'general'`);
    logger.info('Added column pdfs.category');
  }
  if (!columnExists('pdfs', 'owner_sub')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN owner_sub TEXT`);
    logger.info('Added column pdfs.owner_sub');
  }
  if (!columnExists('pdfs', 'visibility')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`);
    logger.info('Added column pdfs.visibility');
  }
  if (!columnExists('pdfs', 'total_audio_duration_seconds')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN total_audio_duration_seconds REAL`);
    logger.info('Added column pdfs.total_audio_duration_seconds');
  }

  // GitHub sync status: `github_synced_commit` records the local git HEAD hash
  // at the moment of the last successful push, and `github_synced_at` its
  // timestamp. Whether a presentation currently has unsynced changes is derived
  // on read by comparing the working tree / current HEAD against this commit
  // (see services/presentationGit.ts#isGithubSyncDirty) — file writes happen
  // through many code paths and don't all go through commitPresentationFile,
  // so a write-time "dirty" flag would miss changes that are only committed in
  // bulk right before a push.
  if (columnExists('pdfs', 'github_sync_dirty')) {
    db.exec(`ALTER TABLE pdfs DROP COLUMN github_sync_dirty`);
    logger.info('Dropped column pdfs.github_sync_dirty');
  }
  if (!columnExists('pdfs', 'github_synced_commit')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN github_synced_commit TEXT`);
    logger.info('Added column pdfs.github_synced_commit');
  }
  if (!columnExists('pdfs', 'github_synced_at')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN github_synced_at TEXT`);
    logger.info('Added column pdfs.github_synced_at');
  }

  // pages table: drop legacy M1 version (it was never populated) and recreate
  // with the M2 schema. Safe because M1 never wrote rows here.
  if (tableExists('pages')) {
    const cols = db.prepare(`PRAGMA table_info(pages)`).all() as ColumnInfoRow[];
    const hasNewShape =
      cols.some((c) => c.name === 'text_path') &&
      cols.some((c) => c.name === 'script_path') &&
      cols.some((c) => c.name === 'error_message') &&
      cols.some((c) => c.name === 'created_at');
    if (!hasNewShape) {
      db.exec(`DROP TABLE pages`);
      logger.info('Dropped legacy pages table (M1 shape)');
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      pdf_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      image_path TEXT,
      text_path TEXT,
      script_path TEXT,
      audio_path TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (pdf_id, page_number),
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pages_pdf ON pages(pdf_id);

    CREATE TABLE IF NOT EXISTS regenerate_jobs (
      pdf_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_regenerate_jobs_status_updated ON regenerate_jobs(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS page_polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pdf_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      question TEXT NOT NULL,
      options_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      show_results INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (pdf_id, page_number) REFERENCES pages(pdf_id, page_number) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_page_polls_pdf_page ON page_polls(pdf_id, page_number, created_at DESC);

    CREATE TABLE IF NOT EXISTS page_poll_votes (
      poll_id INTEGER NOT NULL,
      voter_id TEXT NOT NULL,
      option_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (poll_id, voter_id),
      FOREIGN KEY (poll_id) REFERENCES page_polls(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_page_poll_votes_poll ON page_poll_votes(poll_id);

    CREATE TABLE IF NOT EXISTS pdf_shares (
      token TEXT PRIMARY KEY,
      pdf_id TEXT NOT NULL,
      access TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pdf_shares_pdf ON pdf_shares(pdf_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS pdf_sync_sessions (
      pdf_id TEXT PRIMARY KEY,
      master_client_id TEXT,
      master_expires_at TEXT,
      page_number INTEGER NOT NULL DEFAULT 1,
      is_playing INTEGER NOT NULL DEFAULT 0,
      current_time REAL NOT NULL DEFAULT 0,
      follower_audio_unlocked INTEGER NOT NULL DEFAULT 0,
      realtime_poll_started INTEGER NOT NULL DEFAULT 0,
      quiz_mode INTEGER NOT NULL DEFAULT 0,
      active_quiz_id INTEGER,
      quiz_show_answers INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pdf_sync_sessions_master_expires ON pdf_sync_sessions(master_expires_at);

    CREATE TABLE IF NOT EXISTS quiz_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pdf_id TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_quiz_sets_pdf_updated ON quiz_sets(pdf_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pdf_id TEXT NOT NULL,
      quiz_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      code TEXT,
      answers_json TEXT NOT NULL,
      score REAL,
      submitted_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE,
      FOREIGN KEY (quiz_id) REFERENCES quiz_sets(id) ON DELETE CASCADE,
      UNIQUE (session_id, client_id)
    );

    CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_session ON quiz_attempts(quiz_id, session_id, submitted_at DESC);

    CREATE TABLE IF NOT EXISTS pdf_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pdf_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_name TEXT,
      content_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pdf_sources_pdf_created ON pdf_sources(pdf_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS page_watch_progress (
      pdf_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      viewer_id TEXT NOT NULL,
      listened_ms INTEGER NOT NULL DEFAULT 0,
      tab_hidden_ms INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (pdf_id, page_number, viewer_id),
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_page_watch_progress_pdf_page ON page_watch_progress(pdf_id, page_number);
  `);

  normalizeLifecycleStatuses();

  // M4: add audio_duration_seconds column if missing
  if (!columnExists('pages', 'audio_duration_seconds')) {
    db.exec(`ALTER TABLE pages ADD COLUMN audio_duration_seconds REAL`);
    logger.info('Added column pages.audio_duration_seconds');
  }
  if (!columnExists('pages', 'chat_history_json')) {
    db.exec(`ALTER TABLE pages ADD COLUMN chat_history_json TEXT`);
    logger.info('Added column pages.chat_history_json');
  }
  if (!columnExists('pages', 'page_prompt')) {
    db.exec(`ALTER TABLE pages ADD COLUMN page_prompt TEXT`);
    logger.info('Added column pages.page_prompt');
  }
  // `page_uid` is a stable per-page identifier generated once at creation time
  // and never changed afterwards. Page artifact files on disk are named after
  // it (e.g. pages/<uid>.jpg) instead of the page number, so reordering pages
  // only updates `page_number` in the DB — no file renames are ever needed,
  // which keeps git history (and `--follow`) tracking each slide's actual
  // content rather than whatever currently occupies a given position.
  if (!columnExists('pages', 'page_uid')) {
    db.exec(`ALTER TABLE pages ADD COLUMN page_uid TEXT`);
    logger.info('Added column pages.page_uid');
  }
  const pagesMissingUid = db
    .prepare(`SELECT pdf_id, page_number FROM pages WHERE page_uid IS NULL`)
    .all() as Array<{ pdf_id: string; page_number: number }>;
  if (pagesMissingUid.length > 0) {
    const setUid = db.prepare(`UPDATE pages SET page_uid = ? WHERE pdf_id = ? AND page_number = ?`);
    const backfill = db.transaction((rows: typeof pagesMissingUid) => {
      for (const row of rows) {
        setUid.run(nanoid(10), row.pdf_id, row.page_number);
      }
    });
    backfill(pagesMissingUid);
    logger.info({ count: pagesMissingUid.length }, 'Backfilled page_uid for existing pages');
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_uid ON pages(pdf_id, page_uid)`);
  // GSAP slide animation V1: per-page render mode + animation spec file path.
  if (!columnExists('pages', 'render_type')) {
    db.exec(`ALTER TABLE pages ADD COLUMN render_type TEXT NOT NULL DEFAULT 'static-image'`);
    logger.info('Added column pages.render_type');
  }
  if (!columnExists('pages', 'animation_spec_path')) {
    db.exec(`ALTER TABLE pages ADD COLUMN animation_spec_path TEXT`);
    logger.info('Added column pages.animation_spec_path');
  }
  if (!columnExists('page_polls', 'show_results')) {
    db.exec(`ALTER TABLE page_polls ADD COLUMN show_results INTEGER NOT NULL DEFAULT 1`);
    logger.info('Added column page_polls.show_results');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      pdf_id TEXT NOT NULL,
      run_type TEXT NOT NULL,
      parent_run_id TEXT,
      triggered_by TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_ms INTEGER,
      sla_status TEXT,
      error_code TEXT,
      error_message TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_run_id) REFERENCES pipeline_runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pdf_started ON pipeline_runs(pdf_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status_started ON pipeline_runs(status, started_at DESC);

    CREATE TABLE IF NOT EXISTS pipeline_stage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      pdf_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      event_type TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      duration_ms INTEGER,
      sla_status TEXT,
      error_code TEXT,
      error_message TEXT,
      metadata_json TEXT,
      FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_stage_events_run_stage ON pipeline_stage_events(run_id, stage, attempt, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_pipeline_stage_events_pdf ON pipeline_stage_events(pdf_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS pipeline_stage_summaries (
      run_id TEXT NOT NULL,
      pdf_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      duration_ms INTEGER,
      sla_target_ms INTEGER,
      sla_status TEXT NOT NULL DEFAULT 'unknown',
      error_code TEXT,
      error_message TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, stage),
      FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS page_artifact_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      pdf_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      artifact TEXT NOT NULL,
      event_type TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      reason TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      duration_ms INTEGER,
      sla_status TEXT,
      output_path TEXT,
      error_code TEXT,
      error_message TEXT,
      metadata_json TEXT,
      FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_page_artifact_events_pdf_page ON page_artifact_events(pdf_id, page_number, artifact, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_page_artifact_events_run ON page_artifact_events(run_id, page_number, artifact, attempt);

    CREATE TABLE IF NOT EXISTS page_generation_prompts (
      pdf_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      stage TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (pdf_id, page_number, stage),
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_page_gen_prompts_pdf ON page_generation_prompts(pdf_id, page_number);

    CREATE TABLE IF NOT EXISTS page_artifact_timings (
      pdf_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      artifact TEXT NOT NULL,
      run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      duration_ms INTEGER,
      sla_target_ms INTEGER,
      sla_status TEXT NOT NULL DEFAULT 'unknown',
      output_path TEXT,
      error_code TEXT,
      error_message TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (pdf_id, page_number, artifact),
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS page_drawings (
      pdf_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      drawing_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (pdf_id, page_number),
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_page_drawings_pdf ON page_drawings(pdf_id);

    CREATE TABLE IF NOT EXISTS pipeline_sla_overrides (
      kind TEXT NOT NULL CHECK (kind IN ('stage', 'artifact')),
      name TEXT NOT NULL,
      target_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (kind, name)
    );

    -- 登入時的 Google 帳號基本資料（sub/email/name/picture），讓「其他人擁有的簡報」
    -- 列表可以顯示一個人類可讀的擁有者名稱，而不是只有 owner_sub 這個 Google sub id。
    CREATE TABLE IF NOT EXISTS accounts (
      sub TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_attendees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pdf_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      user_code TEXT,
      joined_at TEXT NOT NULL,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sync_attendees_pdf ON sync_attendees(pdf_id, joined_at);
  `);

  if (!columnExists('quiz_sets', 'time_limit_seconds')) {
    db.exec(`ALTER TABLE quiz_sets ADD COLUMN time_limit_seconds INTEGER NOT NULL DEFAULT 0`);
    logger.info('Added column quiz_sets.time_limit_seconds');
  }

  if (!columnExists('pdfs', 'tags')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN tags TEXT NOT NULL DEFAULT ''`);
    logger.info('Added column pdfs.tags');
  }

  logger.info({ dbPath: config.dbPath }, 'Database migrations applied');
}

function normalizeLifecycleStatuses(): void {
  const now = new Date().toISOString();
  const pdfPlaceholders = PDF_STATUSES.map(() => '?').join(', ');
  const pagePlaceholders = PAGE_STATUSES.map(() => '?').join(', ');

  const invalidPdfs = db
    .prepare(`SELECT COUNT(*) AS count FROM pdfs WHERE status NOT IN (${pdfPlaceholders})`)
    .get(...PDF_STATUSES) as { count: number };
  if (invalidPdfs.count > 0) {
    db.prepare(
      `UPDATE pdfs
          SET status = 'failed',
              error_message = COALESCE(error_message, 'Invalid lifecycle status normalized during migration'),
              updated_at = ?
        WHERE status NOT IN (${pdfPlaceholders})`,
    ).run(now, ...PDF_STATUSES);
    logger.warn({ count: invalidPdfs.count }, 'Normalized invalid PDF lifecycle statuses');
  }

  const invalidPages = db
    .prepare(`SELECT COUNT(*) AS count FROM pages WHERE status NOT IN (${pagePlaceholders})`)
    .get(...PAGE_STATUSES) as { count: number };
  if (invalidPages.count > 0) {
    db.prepare(
      `UPDATE pages
          SET status = 'failed',
              error_message = COALESCE(error_message, 'Invalid lifecycle status normalized during migration'),
              updated_at = ?
        WHERE status NOT IN (${pagePlaceholders})`,
    ).run(now, ...PAGE_STATUSES);
    logger.warn({ count: invalidPages.count }, 'Normalized invalid page lifecycle statuses');
  }
}

migrate();

export function closeDb(): void {
  db.close();
}

export function savePageGenerationPrompt(
  pdfId: string,
  pageNumber: number,
  stage: 'image' | 'script' | 'audio',
  promptText: string,
  model?: string,
): void {
  try {
    db.prepare(
      `INSERT OR REPLACE INTO page_generation_prompts (pdf_id, page_number, stage, prompt_text, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(pdfId, pageNumber, stage, promptText, model ?? null, new Date().toISOString());
  } catch {
    // best-effort; never block generation
  }
}

export interface PageGenerationPrompt {
  stage: string;
  prompt_text: string;
  model: string | null;
  created_at: string;
}

export function getPageGenerationPrompts(
  pdfId: string,
  pageNumber: number,
): PageGenerationPrompt[] {
  return db
    .prepare(
      `SELECT stage, prompt_text, model, created_at
         FROM page_generation_prompts
        WHERE pdf_id = ? AND page_number = ?
        ORDER BY CASE stage WHEN 'image' THEN 1 WHEN 'script' THEN 2 WHEN 'audio' THEN 3 ELSE 4 END`,
    )
    .all(pdfId, pageNumber) as PageGenerationPrompt[];
}
