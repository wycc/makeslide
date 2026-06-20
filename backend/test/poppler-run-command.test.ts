import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../src/worker/poppler';

const NODE = process.execPath;

test('runCommand resolves with stdout/stderr for a successful command', async () => {
  const result = await runCommand(NODE, [
    '-e',
    'process.stdout.write("hello-out"); process.stderr.write("hello-err");',
  ]);
  assert.equal(result.stdout, 'hello-out');
  assert.equal(result.stderr, 'hello-err');
});

test('runCommand rejects with the exit code and output when the command fails', async () => {
  await assert.rejects(
    () => runCommand(NODE, ['-e', 'process.stderr.write("boom"); process.exit(2)']),
    /exited with code 2: boom/,
  );
});

test('runCommand without a timeoutMs option does not kill a process early', async () => {
  // No options object at all (mirrors generateVideo.ts's calls before this fix) — should just
  // wait for the process, not impose an implicit timeout.
  const result = await runCommand(NODE, ['-e', 'setTimeout(() => process.exit(0), 50)']);
  assert.equal(result.stdout, '');
});

test('runCommand kills a process that exceeds timeoutMs instead of waiting for it to exit', async () => {
  const start = Date.now();
  // Sleeps far longer than the timeout below; if the kill didn't work this test would hang for 30s.
  await assert.rejects(
    () => runCommand(NODE, ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 100 }),
    /killed after timeout/,
  );
  assert.ok(Date.now() - start < 5000, 'expected the timed-out process to be killed promptly');
});
