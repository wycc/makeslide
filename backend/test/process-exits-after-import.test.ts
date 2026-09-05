import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

// The worktree running this test may not have its own `node_modules`, so resolve `tsx` the same
// way db-ensures-directory.test.ts does rather than assuming a fixed relative path.
function resolveTsxBin(): string {
  const tsxPkgPath = fileURLToPath(import.meta.resolve('tsx/package.json'));
  const tsxPkg = JSON.parse(fs.readFileSync(tsxPkgPath, 'utf8')) as { bin?: Record<string, string> | string };
  const binRel = typeof tsxPkg.bin === 'string' ? tsxPkg.bin : tsxPkg.bin?.tsx;
  if (!binRel) throw new Error('Could not resolve tsx bin path from package.json');
  return path.resolve(path.dirname(tsxPkgPath), binRel);
}

/**
 * Regression test: `export-job.ts` and `batch-export.ts` each start a 5-minute sweeper with a
 * module-level `setInterval` that was never `unref`'d. Every test file that calls `buildApp()`
 * (136 of them) pulls those modules in through the route registration, so the timer kept the
 * event loop alive forever — the file's assertions all passed, node:test printed every `ok`, and
 * then the child process simply never exited, hanging the whole run. Asserting on process exit
 * rather than grepping the source keeps this honest for any future timer too.
 *
 * The probe has to build the app, not merely import `server.ts`: the routes (and therefore those
 * two modules) are pulled in by an `await import()` inside `buildApp()`, so a bare import loads
 * none of them and would pass even with the timers left dangling.
 */
test('building and closing the app leaves nothing holding the event loop open', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-exit-test-'));
  try {
    const probeFile = path.join(tmpRoot, 'probe.mjs');
    await fs.promises.writeFile(
      probeFile,
      `import { buildApp } from ${JSON.stringify(path.join(backendRoot, 'src', 'server.ts'))};\n` +
        `const app = await buildApp();\nawait app.close();\nconsole.log('IMPORT_OK');\n`,
      'utf8',
    );

    const result = spawnSync(resolveTsxBin(), [probeFile], {
      cwd: backendRoot,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, MAKESLIDE_TEST: '1' },
    });

    assert.equal(
      result.signal,
      null,
      `the app probe did not exit on its own (killed by ${result.signal} after 60s) — ` +
        'something registered a timer or handle without unref()',
    );
    assert.equal(result.status, 0, `expected the probe to exit 0, got ${result.status}. stderr:\n${result.stderr}`);
    assert.match(result.stdout, /IMPORT_OK/);
  } finally {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});
