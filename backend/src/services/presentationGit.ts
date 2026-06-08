import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pdfDir } from './storage';
import { logger } from '../logger';
import { db } from '../db';

const execFile = promisify(execFileCb);

/** Mark a presentation as having local commits not yet pushed to GitHub. */
function markGithubSyncDirty(pdfId: string): void {
  try {
    db.prepare(`UPDATE pdfs SET github_sync_dirty = 1 WHERE id = ?`).run(pdfId);
  } catch (err) {
    logger.warn({ err, pdfId }, 'presentationGit: failed to mark github sync dirty');
  }
}

/** Mark a presentation as fully pushed to GitHub as of now. */
function markGithubSynced(pdfId: string): void {
  try {
    db.prepare(`UPDATE pdfs SET github_sync_dirty = 0, github_synced_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      pdfId,
    );
  } catch (err) {
    logger.warn({ err, pdfId }, 'presentationGit: failed to mark github synced');
  }
}

const GIT_USER_NAME = 'makeslide';
const GIT_USER_EMAIL = 'makeslide@local';

// Track everything in the presentation directory — pages/* (images, audio,
// scripts, thumbnails, ...), cover.jpg/cover.thumb.jpg and metadata.json —
// so that syncing a presentation to another machine fully restores it.
// An empty .gitignore is still written so `git status` stays predictable
// and older repos created under a previous, broader ignore list get reset.
const GITIGNORE_CONTENT = '';

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

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, gitOpts(dir));
  return stdout.trim();
}

/** Initialize a git repo inside the presentation storage directory if not already done. */
export async function ensurePresentationRepo(pdfId: string): Promise<void> {
  const dir = pdfDir(pdfId);
  const gitDir = path.join(dir, '.git');
  const gitignorePath = path.join(dir, '.gitignore');
  try {
    await fs.promises.access(gitDir, fs.constants.F_OK);
    await refreshGitignore(pdfId, dir, gitignorePath);
    return; // already initialized
  } catch {
    // not initialized yet
  }

  try {
    await execFile('git', ['init', '-b', 'main'], gitOpts(dir));
    await fs.promises.writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf8');
    await execFile('git', ['add', '.gitignore'], gitOpts(dir));
    await execFile(
      'git',
      ['commit', '-m', 'chore: init presentation repository', '--allow-empty'],
      gitOpts(dir),
    );
  } catch (err) {
    logger.warn({ err, pdfId }, 'presentationGit: failed to init repo');
  }
}

/**
 * Keep an existing presentation repo's .gitignore in sync with GITIGNORE_CONTENT.
 * Older repos may have been created with a broader ignore list; rewriting it
 * here lets previously-excluded files (audio, video, source, captions, etc.)
 * become trackable on the next commit/push without recreating the repo.
 */
async function refreshGitignore(pdfId: string, dir: string, gitignorePath: string): Promise<void> {
  let current: string | null = null;
  try {
    current = await fs.promises.readFile(gitignorePath, 'utf8');
  } catch {
    current = null;
  }
  if (current === GITIGNORE_CONTENT) return;
  try {
    await fs.promises.writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf8');
    await execFile('git', ['add', '.gitignore'], gitOpts(dir));
    const status = await git(dir, ['status', '--porcelain', '--', '.gitignore']);
    if (!status) return;
    await execFile(
      'git',
      ['commit', '-m', 'chore: update .gitignore', '--', '.gitignore'],
      gitOpts(dir),
    );
  } catch (err) {
    logger.warn({ err, pdfId }, 'presentationGit: failed to refresh .gitignore');
  }
}

/**
 * Stage and commit every change in the working tree (respecting .gitignore).
 * Used before pushing to GitHub so that files which only recently became
 * trackable (because the ignore list shrank) are included even though no
 * specific worker step calls commitPresentationFile for them.
 */
async function commitAllPendingChanges(pdfId: string, dir: string, message: string): Promise<void> {
  try {
    await execFile('git', ['add', '-A'], gitOpts(dir));
    const status = await git(dir, ['status', '--porcelain']);
    if (!status) return;
    await execFile('git', ['commit', '-m', message], gitOpts(dir));
    markGithubSyncDirty(pdfId);
  } catch (err) {
    logger.warn({ err, pdfId }, 'presentationGit: failed to commit pending changes');
  }
}

/**
 * Commit a file into the presentation's git repo.
 * `relPath` is relative to the presentation directory (e.g. "pages/001.jpg").
 */
export async function commitPresentationFile(
  pdfId: string,
  relPath: string,
  message: string,
): Promise<void> {
  const dir = pdfDir(pdfId);
  try {
    await ensurePresentationRepo(pdfId);
    await execFile('git', ['add', '--', relPath], gitOpts(dir));
    // Check if there is actually something to commit
    const status = await git(dir, ['status', '--porcelain', '--', relPath]);
    if (!status) return; // nothing changed
    await execFile('git', ['commit', '-m', message, '--', relPath], gitOpts(dir));
    markGithubSyncDirty(pdfId);
  } catch (err) {
    // Non-fatal: versioning failures must not break the main flow
    logger.warn({ err, pdfId, relPath }, 'presentationGit: commit failed');
  }
}

/**
 * Commit multiple files in a single commit.
 */
export async function commitPresentationFiles(
  pdfId: string,
  relPaths: string[],
  message: string,
): Promise<void> {
  if (relPaths.length === 0) return;
  const dir = pdfDir(pdfId);
  try {
    await ensurePresentationRepo(pdfId);
    await execFile('git', ['add', '--', ...relPaths], gitOpts(dir));
    const status = await git(dir, ['status', '--porcelain']);
    if (!status) return;
    await execFile('git', ['commit', '-m', message, '--', ...relPaths], gitOpts(dir));
    markGithubSyncDirty(pdfId);
  } catch (err) {
    logger.warn({ err, pdfId, relPaths }, 'presentationGit: multi-file commit failed');
  }
}

/**
 * Build an authenticated remote URL by embedding a personal access token
 * into an https GitHub repository URL (e.g. https://x-access-token:<token>@github.com/owner/repo.git).
 * Non-https URLs (e.g. git@github.com:...) are returned unchanged since tokens
 * cannot be embedded in the SSH form.
 */
export function buildAuthenticatedRepoUrl(repoUrl: string, token: string): string {
  const trimmedUrl = repoUrl.trim();
  const trimmedToken = token.trim();
  if (!trimmedToken) return trimmedUrl;
  try {
    const parsed = new URL(trimmedUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return trimmedUrl;
    parsed.username = 'x-access-token';
    parsed.password = trimmedToken;
    return parsed.toString();
  } catch {
    return trimmedUrl;
  }
}

const TEXT_MERGE_EXTENSIONS = new Set(['.txt', '.md', '.json']);

function isTextMergeCandidate(relPath: string): boolean {
  return TEXT_MERGE_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

/** Read a file at a given conflict stage (`:1:path`/`:2:path`/`:3:path`); null if absent there. */
async function showStagedBlob(dir: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['show', ref], gitOpts(dir));
    return stdout;
  } catch {
    return null; // not present at this stage (e.g. add/add or modify/delete conflict)
  }
}

/**
 * Resolve a conflicted text file with a union merge: every line either side
 * added is kept (identical changes collapse to one copy, conflicting edits
 * are concatenated) instead of leaving conflict markers or dropping a side.
 */
async function resolveTextConflict(pdfId: string, dir: string, relPath: string): Promise<void> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-merge-'));
  try {
    const [base, ours, theirs] = await Promise.all([
      showStagedBlob(dir, `:1:${relPath}`),
      showStagedBlob(dir, `:2:${relPath}`),
      showStagedBlob(dir, `:3:${relPath}`),
    ]);
    const basePath = path.join(tmpDir, 'base');
    const oursPath = path.join(tmpDir, 'ours');
    const theirsPath = path.join(tmpDir, 'theirs');
    await Promise.all([
      fs.promises.writeFile(basePath, base ?? ''),
      fs.promises.writeFile(oursPath, ours ?? ''),
      fs.promises.writeFile(theirsPath, theirs ?? ''),
    ]);
    const { stdout } = await execFile(
      'git',
      ['merge-file', '--union', '-p', oursPath, basePath, theirsPath],
      gitOpts(dir),
    );
    await fs.promises.writeFile(path.join(dir, relPath), stdout, 'utf8');
  } catch (err) {
    logger.warn({ err, pdfId, relPath }, 'presentationGit: text union merge failed, leaving conflict markers');
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

async function lastCommitTimeForPath(dir: string, ref: string, relPath: string): Promise<number> {
  try {
    const out = await git(dir, ['log', '-1', '--format=%ct', ref, '--', relPath]);
    return out ? Number.parseInt(out, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Resolve a conflicted non-text file (image/audio/video/pdf/...) by keeping
 * whichever side committed a change to that path more recently — binary
 * content cannot be merged line-by-line, so "newest wins" is the best
 * automatic resolution available.
 */
async function resolveBinaryConflict(
  pdfId: string,
  dir: string,
  relPath: string,
  remoteRef: string,
): Promise<void> {
  const [oursTime, theirsTime] = await Promise.all([
    lastCommitTimeForPath(dir, 'HEAD', relPath),
    lastCommitTimeForPath(dir, remoteRef, relPath),
  ]);
  const side = theirsTime > oursTime ? 'theirs' : 'ours';
  try {
    await execFile('git', ['checkout', `--${side}`, '--', relPath], gitOpts(dir));
  } catch (err) {
    // Path absent on the chosen (newer) side — a delete/modify conflict; drop it.
    logger.warn({ err, pdfId, relPath, side }, 'presentationGit: binary conflict checkout failed, removing file');
    await execFile('git', ['rm', '-f', '--ignore-unmatch', '--', relPath], gitOpts(dir));
  }
}

/**
 * Fetch the presentation's branch from the configured GitHub remote and merge
 * it into the local branch before pushing, so edits made on another machine
 * are folded in instead of being clobbered by the subsequent force-push.
 * Each machine initializes its own local repo, so histories are unrelated;
 * conflicts are resolved automatically — text files (scripts, captions,
 * outline, metadata) via a union merge that keeps both sides' edits, and
 * every other (binary) file by keeping whichever side last touched the path
 * more recently.
 */
async function pullAndMergeFromGitHub(pdfId: string, dir: string, authenticatedUrl: string): Promise<void> {
  const remoteRef = `refs/remotes/github-sync/${pdfId}`;
  try {
    await execFile('git', ['fetch', authenticatedUrl, `refs/heads/${pdfId}:${remoteRef}`], gitOpts(dir));
  } catch {
    return; // remote branch doesn't exist yet — nothing to pull
  }

  try {
    await execFile(
      'git',
      ['merge', '--no-edit', '--allow-unrelated-histories', remoteRef],
      gitOpts(dir),
    );
    return; // already up to date, fast-forwarded, or merged cleanly
  } catch {
    // fall through to conflict resolution below
  }

  const conflicted = (await git(dir, ['diff', '--name-only', '--diff-filter=U']))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const relPath of conflicted) {
    if (isTextMergeCandidate(relPath)) {
      await resolveTextConflict(pdfId, dir, relPath);
    } else {
      await resolveBinaryConflict(pdfId, dir, relPath, remoteRef);
    }
    await execFile('git', ['add', '--', relPath], gitOpts(dir));
  }

  try {
    await execFile('git', ['commit', '--no-edit'], gitOpts(dir));
  } catch (err) {
    logger.warn({ err, pdfId }, 'presentationGit: failed to finalize merge commit');
  }
}

/**
 * Push a presentation's local git repository to a branch named after the
 * presentation id on the configured GitHub remote. Each presentation keeps
 * its own branch so multiple presentations can share a single repository.
 * Pulls and auto-merges remote changes first so syncing from multiple
 * machines folds edits together instead of overwriting them.
 */
export async function pushPresentationToGitHub(
  pdfId: string,
  repoUrl: string,
  token: string,
): Promise<void> {
  const trimmedRepoUrl = repoUrl.trim();
  if (!trimmedRepoUrl) throw new Error('GitHub repository URL is not configured');

  const dir = pdfDir(pdfId);
  await ensurePresentationRepo(pdfId);
  await commitAllPendingChanges(pdfId, dir, 'sync: snapshot before GitHub push');
  const authenticatedUrl = buildAuthenticatedRepoUrl(trimmedRepoUrl, token);
  await pullAndMergeFromGitHub(pdfId, dir, authenticatedUrl);
  const branch = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  await execFile(
    'git',
    ['push', authenticatedUrl, `${branch}:refs/heads/${pdfId}`, '--force'],
    gitOpts(dir),
  );
  markGithubSynced(pdfId);
}

export interface FileVersionEntry {
  hash: string;
  date: string;
  message: string;
}

/**
 * Return the git log for a specific file inside a presentation repo.
 * `relPath` is relative to the presentation directory.
 */
export async function getPresentationFileHistory(
  pdfId: string,
  relPath: string,
): Promise<FileVersionEntry[]> {
  const dir = pdfDir(pdfId);
  try {
    const out = await git(dir, [
      'log',
      '--follow',
      '--format=%H\x1f%aI\x1f%s',
      '--',
      relPath,
    ]);
    if (!out) return [];
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash = '', date = '', ...rest] = line.split('\x1f');
        return { hash, date, message: rest.join('\x1f') };
      });
  } catch {
    return [];
  }
}

/**
 * Return the raw file content at a specific commit hash.
 * Suitable for binary (image) and text (script) files.
 */
export async function getPresentationFileAtCommit(
  pdfId: string,
  relPath: string,
  hash: string,
): Promise<Buffer> {
  const dir = pdfDir(pdfId);
  const { stdout } = await execFile(
    'git',
    ['show', `${hash}:${relPath}`],
    { ...gitOpts(dir), encoding: 'buffer' } as Parameters<typeof execFile>[2],
  );
  return stdout as unknown as Buffer;
}

/**
 * Restore a file in the working tree to the state at a given commit and
 * create a new commit recording the rollback.
 */
export async function restorePresentationFile(
  pdfId: string,
  relPath: string,
  hash: string,
  message: string,
): Promise<void> {
  const dir = pdfDir(pdfId);
  await ensurePresentationRepo(pdfId);
  // Write old version back to disk
  const content = await getPresentationFileAtCommit(pdfId, relPath, hash);
  const abs = path.join(dir, relPath);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, content);
  // Commit the restore
  await execFile('git', ['add', '--', relPath], gitOpts(dir));
  const status = await git(dir, ['status', '--porcelain', '--', relPath]);
  if (!status) return; // already at that version
  await execFile('git', ['commit', '-m', message, '--', relPath], gitOpts(dir));
}
