import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gitOpts, GIT_COMMAND_TIMEOUT_MS } from '../src/services/presentationGit';

const execFile = promisify(execFileCb);

test('gitOpts sets a positive timeout alongside the existing cwd and git author/committer env', () => {
  const opts = gitOpts('/tmp/some-presentation-dir');
  assert.equal(opts.cwd, '/tmp/some-presentation-dir');
  assert.equal(opts.timeout, GIT_COMMAND_TIMEOUT_MS);
  assert.ok(GIT_COMMAND_TIMEOUT_MS > 0);
  assert.equal(opts.env.GIT_AUTHOR_NAME, 'makeslide');
  assert.equal(opts.env.GIT_COMMITTER_EMAIL, 'makeslide@local');
});

test('a git invocation that exceeds the configured timeout is killed instead of hanging forever', async () => {
  // Replace `git` on PATH with a script that sleeps far longer than the
  // (overridden, short) timeout, simulating a stuck git process (lock
  // contention, a hanging hook, an unreachable remote, ...).
  const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'makeslide-fakegit-'));
  const fakeGitPath = path.join(fakeBinDir, 'git');
  fs.writeFileSync(fakeGitPath, '#!/bin/sh\nsleep 5\n', { mode: 0o755 });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makeslide-gitopts-test-'));
  try {
    const opts = gitOpts(dir);
    const overridden = {
      ...opts,
      timeout: 100,
      env: { ...opts.env, PATH: `${fakeBinDir}:${process.env.PATH ?? ''}` },
    };
    await assert.rejects(() => execFile('git', ['status'], overridden), (err: unknown) => {
      return err instanceof Error && (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
    });
  } finally {
    fs.rmSync(fakeBinDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
