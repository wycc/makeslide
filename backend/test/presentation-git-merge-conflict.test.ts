import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { pullAndMergeFromGitHub } from '../src/services/presentationGit';

const execFile = promisify(execFileCb);

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd, env: GIT_ENV });
  return stdout;
}

test('pullAndMergeFromGitHub resolves a binary delete/modify conflict instead of crashing the merge', async () => {
  // Reproduces a real merge scenario: a presentation's local repo modifies an image while the
  // GitHub remote (e.g. synced from another machine) deletes it, and the remote's deletion is
  // chronologically the later edit, so resolveBinaryConflict()'s "newest wins" rule picks the
  // remote side. `git checkout --theirs` then fails (the path doesn't exist on that side) and
  // falls back to `git rm`, which already stages the deletion — a subsequent unconditional
  // `git add` on that now-nonexistent path used to throw and abort the whole merge before the
  // final commit ever ran.
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'presentationgit-conflict-'));
  const localDir = path.join(tmpDir, 'local');
  const remoteDir = path.join(tmpDir, 'remote');
  const pdfId = 'conflict-test-pdf';
  try {
    await fs.promises.mkdir(localDir, { recursive: true });
    await git(localDir, ['init', '-q', '-b', pdfId]);
    await fs.promises.writeFile(path.join(localDir, 'page.jpg'), 'AAAA');
    await git(localDir, ['add', 'page.jpg']);
    await git(localDir, ['commit', '-q', '-m', 'base']);

    await execFile('git', ['clone', '-q', localDir, remoteDir]);

    await fs.promises.writeFile(path.join(localDir, 'page.jpg'), 'BBBB');
    await git(localDir, ['commit', '-q', '-am', 'local modifies page']);

    // The remote's delete must be strictly later than the local modify (resolveBinaryConflict()
    // compares commit timestamps with second resolution) for "newest wins" to pick the delete.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await git(remoteDir, ['checkout', '-q', pdfId]);
    await fs.promises.rm(path.join(remoteDir, 'page.jpg'));
    await git(remoteDir, ['commit', '-q', '-am', 'remote deletes page later']);

    await assert.doesNotReject(() => pullAndMergeFromGitHub(pdfId, localDir, remoteDir));

    // The merge must have actually completed end to end (not aborted partway through conflict
    // resolution): no leftover conflict state, and the file genuinely gone from the local repo.
    const status = await git(localDir, ['status', '--short']);
    assert.equal(status.trim(), '');
    assert.equal(fs.existsSync(path.join(localDir, 'page.jpg')), false);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});
