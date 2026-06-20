import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnWithTimeout } from '../src/services/youtubeCaptions';

const NODE = process.execPath;

test('spawnWithTimeout resolves with the exit code for a fast-exiting process', async () => {
  const result = await spawnWithTimeout(NODE, ['-e', 'process.exit(0)'], {}, 5000);
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.spawnError, null);
});

test('spawnWithTimeout reports a non-zero exit code without timing out', async () => {
  const result = await spawnWithTimeout(NODE, ['-e', 'process.exit(3)'], {}, 5000);
  assert.equal(result.code, 3);
  assert.equal(result.timedOut, false);
});

test('spawnWithTimeout captures stdout and stderr', async () => {
  const result = await spawnWithTimeout(
    NODE,
    ['-e', 'process.stdout.write("hello-out"); process.stderr.write("hello-err");'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
    5000,
  );
  assert.equal(result.stdout, 'hello-out');
  assert.equal(result.stderr, 'hello-err');
});

test('spawnWithTimeout kills a process that exceeds the timeout instead of waiting for it to exit', async () => {
  const start = Date.now();
  // Sleeps far longer than the timeout below; if the kill didn't work this test would hang for 30s.
  const result = await spawnWithTimeout(NODE, ['-e', 'setTimeout(() => {}, 30000)'], {}, 100);
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - start < 5000, 'expected the timed-out process to be killed promptly');
});

test('spawnWithTimeout resolves with a spawnError instead of throwing when the command does not exist', async () => {
  const result = await spawnWithTimeout('this-command-does-not-exist-12345', [], {}, 5000);
  assert.ok(result.spawnError instanceof Error);
  assert.equal(result.code, null);
  assert.equal(result.timedOut, false);
});
