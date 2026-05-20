import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';
import { logger } from './logger';
import { PDF_STATUSES, PAGE_STATUSES } from './statusMachine';

// Ensure DB directory exists
//fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

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

  if (!columnExists('pdfs', 'tts_voice')) {
    db.exec(`ALTER TABLE pdfs ADD COLUMN tts_voice TEXT`);
    logger.info('Added column pdfs.tts_voice');
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
  `);

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
