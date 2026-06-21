import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../src/config';
import { commitPresentationFiles } from '../src/services/presentationGit';

const execFile = promisify(execFileCb);

async function commitCount(dir: string): Promise<number> {
  const { stdout } = await execFile('git', ['rev-list', '--count', 'HEAD'], { cwd: dir });
  return Number.parseInt(stdout.trim(), 10);
}

test('commitPresentationFiles commits the given paths when they actually changed', async () => {
  const pdfId = 'commitfiles-normal-01';
  const dir = path.join(config.storageRoot, pdfId);
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
  try {
    await fs.promises.writeFile(path.join(dir, 'a.txt'), 'a1');
    await fs.promises.writeFile(path.join(dir, 'b.txt'), 'b1');
    await commitPresentationFiles(pdfId, ['a.txt', 'b.txt'], 'initial');
    const afterFirst = await commitCount(dir);
    assert.ok(afterFirst >= 1);

    await fs.promises.writeFile(path.join(dir, 'a.txt'), 'a2');
    await commitPresentationFiles(pdfId, ['a.txt'], 'update a');
    assert.equal(await commitCount(dir), afterFirst + 1);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test('commitPresentationFiles is a no-op for unchanged paths even when another file in the repo is dirty', async () => {
  // Without scoping the status check to relPaths (matching commitPresentationFile's existing
  // pattern), an unrelated dirty file elsewhere in the working tree makes `git status --porcelain`
  // look non-empty, so this used to attempt — and fail — a commit scoped to relPaths that have
  // genuinely nothing to commit, logging a spurious warning every time.
  const pdfId = 'commitfiles-unrelated-dirty-01';
  const dir = path.join(config.storageRoot, pdfId);
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
  try {
    await fs.promises.writeFile(path.join(dir, 'a.txt'), 'a1');
    await fs.promises.writeFile(path.join(dir, 'b.txt'), 'b1');
    await commitPresentationFiles(pdfId, ['a.txt', 'b.txt'], 'initial');
    const baseline = await commitCount(dir);

    await fs.promises.writeFile(path.join(dir, 'a.txt'), 'a2-dirty');
    await assert.doesNotReject(() => commitPresentationFiles(pdfId, ['b.txt'], 'no-op for b'));
    assert.equal(await commitCount(dir), baseline);

    // a.txt's own uncommitted change is untouched by the no-op call above.
    const status = await execFile('git', ['status', '--porcelain'], { cwd: dir });
    assert.match(status.stdout, /a\.txt/);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
