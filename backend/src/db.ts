import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';
import { logger } from './logger';

// Ensure DB directory exists
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
  `);

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

  logger.info({ dbPath: config.dbPath }, 'Database migrations applied');
}

migrate();

export function closeDb(): void {
  db.close();
}
