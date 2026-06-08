/**
 * 一次性遷移：把既有簡報的頁面產物檔名從「頁碼」改成「固定 page_uid」。
 *
 * 背景：`pages/00N.jpg` 這種依頁碼命名的方式，在頁面搬移/插入/刪除時必須整批
 * rename 才能維持路徑與頁碼一致，而這種「同路徑換內容」的 cascading rename
 * 在 git 眼中只是一連串 M/A/D，完全無法被偵測為 rename，導致 `git log --follow`
 * 斷裂。改用建立時就決定、永不改變的 `page_uid` 命名後，搬移頁面只需要更新
 * DB 的 `page_number`，磁碟檔案完全不動。
 *
 * 這支腳本把舊簡報的檔案從 `pages/00N.*` 一次性 rename 成 `pages/<uid>.*`：
 * 因為內容完全相同（100% 相似度），git 這次能正確配對成 rename，
 * `--follow` 從這個 commit 起會接續舊歷史。
 *
 * 用法：cd backend && npx tsx scripts/migrate-page-uids.ts [pdfId ...]
 *   不帶參數則處理所有簡報；帶參數則只處理指定的 pdfId。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '../src/db';
import { logger } from '../src/logger';
import { pagesDir, pdfDir, readMetadata, writeMetadata } from '../src/services/storage';
import { ensurePresentationRepo } from '../src/services/presentationGit';

const execFile = promisify(execFileCb);

const GIT_USER_NAME = 'makeslide';
const GIT_USER_EMAIL = 'makeslide@local';

function gitOpts(dir: string) {
  return {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: GIT_USER_NAME,
      GIT_AUTHOR_EMAIL: GIT_USER_EMAIL,
      GIT_COMMITTER_NAME: GIT_USER_NAME,
      GIT_COMMITTER_EMAIL: GIT_USER_EMAIL,
    },
  };
}

/**
 * Stage and commit the rename as a delete+add pair that git can match by
 * content similarity. Plain `git add -- <oldPath> <newPath>` (which
 * commitPresentationFiles uses) fails fast with "pathspec did not match any
 * files" when the old path was never tracked (common — many presentations'
 * pages/ directories are entirely untracked until first explicit commit) and
 * no longer exists on disk after the rename. `git add -A -- <pathspec>`
 * handles additions, modifications and deletions uniformly regardless of
 * whether the old path was tracked.
 */
async function commitRenames(dir: string, message: string): Promise<void> {
  await execFile('git', ['add', '-A', '--', 'pages'], gitOpts(dir));
  if (fs.existsSync(path.join(dir, 'metadata.json'))) {
    await execFile('git', ['add', '--', 'metadata.json'], gitOpts(dir));
  }
  const status = (await execFile('git', ['status', '--porcelain'], gitOpts(dir))).stdout.trim();
  if (!status) return;
  await execFile('git', ['commit', '-m', message], gitOpts(dir));
}

const ARTIFACT_SUFFIXES = ['.jpg', '.thumb.jpg', '.png', '.text.txt', '.script.txt', '.mp3', '.m4a'] as const;

function legacyPad(pageCount: number): number {
  return pageCount > 999 ? 4 : 3;
}

function legacyBaseName(pageNumber: number, pageCount: number): string {
  return String(pageNumber).padStart(legacyPad(pageCount), '0');
}

/**
 * "Clean enough to migrate" means: no tracked file has staged or unstaged
 * modifications. Untracked files (`??`) are fine — many presentations have
 * never been committed yet (commitPresentationFile* only fires on specific
 * mutations), so their entire `pages/` directory is legitimately untracked.
 * Mixing migration renames with a *modified tracked file* is what we want to
 * avoid, since that could produce a confusing half-migrated commit.
 */
async function gitStatusClean(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execFile('git', ['status', '--porcelain'], { cwd: dir });
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.every((line) => line.startsWith('??'));
  } catch {
    // No repo yet — ensurePresentationRepo will init it; nothing to conflict with.
    return true;
  }
}

interface PageRow {
  page_number: number;
  page_uid: string;
  image_path: string | null;
  text_path: string | null;
  script_path: string | null;
  audio_path: string | null;
}

async function migratePdf(pdfId: string): Promise<void> {
  const pdfRow = db.prepare(`SELECT id, page_count FROM pdfs WHERE id = ?`).get(pdfId) as
    | { id: string; page_count: number | null }
    | undefined;
  if (!pdfRow) {
    logger.warn({ pdfId }, 'migrate-page-uids: pdf not found, skipping');
    return;
  }
  const pageCount = pdfRow.page_count ?? 0;
  if (pageCount <= 0) {
    logger.info({ pdfId }, 'migrate-page-uids: no pages, skipping');
    return;
  }

  const dir = pdfDir(pdfId);
  if (!fs.existsSync(dir)) {
    logger.info({ pdfId }, 'migrate-page-uids: storage dir missing, skipping');
    return;
  }

  await ensurePresentationRepo(pdfId);
  if (!(await gitStatusClean(dir))) {
    logger.warn({ pdfId }, 'migrate-page-uids: working tree not clean, skipping (commit/stash first)');
    return;
  }

  const pageRows = db
    .prepare(
      `SELECT page_number, page_uid, image_path, text_path, script_path, audio_path
         FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
    )
    .all(pdfId) as PageRow[];

  const dirAbs = pagesDir(pdfId);
  const updatedAt = new Date().toISOString();

  const updateImage = db.prepare(`UPDATE pages SET image_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`);
  const updateText = db.prepare(`UPDATE pages SET text_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`);
  const updateScript = db.prepare(`UPDATE pages SET script_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`);
  const updateAudio = db.prepare(`UPDATE pages SET audio_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`);

  let renamedCount = 0;

  for (const page of pageRows) {
    const legacyBase = legacyBaseName(page.page_number, pageCount);
    for (const suffix of ARTIFACT_SUFFIXES) {
      const from = path.join(dirAbs, `${legacyBase}${suffix}`);
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(from);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      const to = path.join(dirAbs, `${page.page_uid}${suffix}`);
      await fs.promises.rename(from, to);
      renamedCount += 1;

      const relFrom = path.posix.join('pages', `${legacyBase}${suffix}`);
      const relTo = path.posix.join('pages', `${page.page_uid}${suffix}`);

      switch (suffix) {
        case '.jpg':
        case '.png':
          if (page.image_path === relFrom) updateImage.run(relTo, updatedAt, pdfId, page.page_number);
          break;
        case '.text.txt':
          if (page.text_path === relFrom) updateText.run(relTo, updatedAt, pdfId, page.page_number);
          break;
        case '.script.txt':
          if (page.script_path === relFrom) updateScript.run(relTo, updatedAt, pdfId, page.page_number);
          break;
        case '.mp3':
        case '.m4a':
          if (page.audio_path === relFrom) updateAudio.run(relTo, updatedAt, pdfId, page.page_number);
          break;
        default:
          break;
      }
    }
  }

  if (renamedCount === 0) {
    logger.info({ pdfId }, 'migrate-page-uids: nothing to rename, already migrated');
    return;
  }

  // Rebuild metadata.json pages[] from the now-updated DB rows.
  const refreshedRows = db
    .prepare(
      `SELECT page_number, image_path, text_path, script_path, audio_path
         FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
    )
    .all(pdfId) as Array<{
    page_number: number;
    image_path: string | null;
    text_path: string | null;
    script_path: string | null;
    audio_path: string | null;
  }>;

  const meta = await readMetadata(pdfId);
  if (meta) {
    for (const row of refreshedRows) {
      const mp = meta.pages.find((x) => x.page_number === row.page_number);
      if (!mp) continue;
      if (row.image_path) mp.image = row.image_path;
      if (row.text_path) mp.text = row.text_path;
      if (row.script_path) mp.script = row.script_path;
      if (row.audio_path) mp.audio = row.audio_path;
    }
    meta.updated_at = updatedAt;
    await writeMetadata(pdfId, meta);
  }

  db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(updatedAt, pdfId);

  await commitRenames(dir, 'chore: migrate page filenames to stable uids');

  logger.info({ pdfId, renamedCount }, 'migrate-page-uids: migration complete');
}

async function main(): Promise<void> {
  const explicitIds = process.argv.slice(2);
  const pdfIds =
    explicitIds.length > 0
      ? explicitIds
      : ((db.prepare(`SELECT id FROM pdfs ORDER BY created_at ASC`).all() as Array<{ id: string }>).map((r) => r.id));

  logger.info({ count: pdfIds.length }, 'migrate-page-uids: starting');
  for (const pdfId of pdfIds) {
    try {
      await migratePdf(pdfId);
    } catch (err) {
      logger.error({ err, pdfId }, 'migrate-page-uids: failed for pdf');
    }
  }
  logger.info('migrate-page-uids: done');
}

await main();
