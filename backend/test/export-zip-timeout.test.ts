import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runZipCommand } from '../src/routes/pdfs/export';

async function createExecutableScript(source: string): Promise<{ command: string; cleanup: () => Promise<void> }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-zip-test-'));
  const command = path.join(dir, 'fake-zip.mjs');
  await fs.promises.writeFile(command, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await fs.promises.chmod(command, 0o755);
  return {
    command,
    cleanup: () => fs.promises.rm(dir, { recursive: true, force: true }),
  };
}

test('runZipCommand resolves when zip exits successfully before the timeout', async () => {
  const script = await createExecutableScript('process.exit(0);');
  try {
    await runZipCommand('.', 'out.zip', { command: script.command, timeoutMs: 5000 });
  } finally {
    await script.cleanup();
  }
});

test('runZipCommand kills and rejects when zip exceeds the timeout', async () => {
  const script = await createExecutableScript('setTimeout(() => {}, 30000);');
  const start = Date.now();
  try {
    await assert.rejects(
      () => runZipCommand('.', 'out.zip', { command: script.command, timeoutMs: 100 }),
      /zip command timed out after 100 ms/,
    );
    assert.ok(Date.now() - start < 5000, 'expected the timed-out zip process to be killed promptly');
  } finally {
    await script.cleanup();
  }
});
