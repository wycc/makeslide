import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runUnzipCommand } from '../src/routes/pdfs/unzip';

async function createExecutableScript(source: string): Promise<{ command: string; cleanup: () => Promise<void> }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-unzip-test-'));
  const command = path.join(dir, 'fake-unzip.mjs');
  await fs.promises.writeFile(command, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await fs.promises.chmod(command, 0o755);
  return {
    command,
    cleanup: () => fs.promises.rm(dir, { recursive: true, force: true }),
  };
}

test('runUnzipCommand resolves when unzip exits successfully before the timeout', async () => {
  const script = await createExecutableScript('process.exit(0);');
  try {
    await runUnzipCommand('input.zip', 'out', { command: script.command, timeoutMs: 5000 });
  } finally {
    await script.cleanup();
  }
});

test('runUnzipCommand kills and rejects when unzip exceeds the timeout', async () => {
  const script = await createExecutableScript('setTimeout(() => {}, 30000);');
  const start = Date.now();
  try {
    await assert.rejects(
      () => runUnzipCommand('input.zip', 'out', { command: script.command, timeoutMs: 100 }),
      /unzip command timed out after 100 ms/,
    );
    assert.ok(Date.now() - start < 5000, 'expected the timed-out unzip process to be killed promptly');
  } finally {
    await script.cleanup();
  }
});
