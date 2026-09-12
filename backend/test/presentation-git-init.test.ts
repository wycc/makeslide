import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../src/config';
import { commitPresentationFile, ensurePresentationRepo } from '../src/services/presentationGit';

const execFile = promisify(execFileCb);

/**
 * Repo creation used to run `git init -b main`, which needs git >= 2.28. On an older git it threw,
 * and since every failure here is deliberately non-fatal, the result was an absence nobody noticed:
 * decks had no version history, no image restore and no GitHub sync (on the git 2.25 host where
 * this was found, 2 of 130 decks had a repo). These tests assert the repo actually exists — the
 * thing the swallowed error hid.
 */
test('ensurePresentationRepo really creates a repo, on whatever git this machine has', async () => {
  const pdfId = 'gitinit-creates-01';
  const dir = path.join(config.storageRoot, pdfId);
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
  try {
    await ensurePresentationRepo(pdfId);
    assert.ok(fs.existsSync(path.join(dir, '.git')), 'the repo exists');
    const { stdout: branch } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
    assert.equal(branch.trim(), 'main', 'on the branch the push path expects');
    const { stdout: count } = await execFile('git', ['rev-list', '--count', 'HEAD'], { cwd: dir });
    assert.ok(Number.parseInt(count.trim(), 10) >= 1, 'with the initial commit in place');
    assert.ok(fs.existsSync(path.join(dir, '.gitignore')));
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test('a file committed into a fresh deck is retrievable from history', async () => {
  const pdfId = 'gitinit-history-01';
  const dir = path.join(config.storageRoot, pdfId);
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(path.join(dir, 'pages'), { recursive: true });
  try {
    await fs.promises.writeFile(path.join(dir, 'pages', 'p1.script.txt'), 'first version', 'utf8');
    await commitPresentationFile(pdfId, 'pages/p1.script.txt', 'script: page 1');
    // This is what image/script history and restore read; with no repo it returned nothing.
    const { stdout } = await execFile('git', ['log', '--format=%H', '--', 'pages/p1.script.txt'], { cwd: dir });
    assert.ok(stdout.trim().split('\n').filter(Boolean).length >= 1, 'the file has history');
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
