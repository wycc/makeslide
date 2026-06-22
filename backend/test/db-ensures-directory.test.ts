import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

/**
 * The worktree running this test may not have its own `node_modules` (it can rely on
 * the main checkout's), so resolve the `tsx` binary via Node's own module resolution
 * starting from this test file rather than assuming a fixed relative path.
 */
function resolveTsxBin(): string {
  const tsxPkgUrl = import.meta.resolve('tsx/package.json');
  const tsxPkgPath = fileURLToPath(tsxPkgUrl);
  const tsxPkg = JSON.parse(fs.readFileSync(tsxPkgPath, 'utf8')) as { bin?: Record<string, string> | string };
  const binRel = typeof tsxPkg.bin === 'string' ? tsxPkg.bin : tsxPkg.bin?.tsx;
  if (!binRel) throw new Error('Could not resolve tsx bin path from package.json');
  return path.resolve(path.dirname(tsxPkgPath), binRel);
}

const tsxBin = resolveTsxBin();

/**
 * Regression test for the deployment-stability bug fixed alongside this test: `db.ts`
 * is reached via a static `import { db } from './db'` at the top of `server.ts`, which
 * per the ES module spec is resolved (and its top-level side effects executed) before
 * any of server.ts's own code runs — including `startServer()`'s call to
 * `ensureWorkspaceRuntimePaths()`, which this codebase used to rely on to create the
 * `data/`/`storage/` directories first. That ordering never actually held in practice:
 * on a brand-new checkout/volume where `DB_PATH`'s parent directory doesn't exist yet,
 * `new Database(config.dbPath)` throws an uncaught "Cannot open database because the
 * directory does not exist" error during module initialization, before `startServer()`'s
 * try/catch in `main()` ever gets a chance to run — crashing the process before any
 * logging happens. Production Docker deployments only avoided this because the
 * container CMD happens to `mkdir -p` the data dir before invoking node at all (see
 * Dockerfile), masking the bug for that one specific deployment path.
 *
 * This spawns a real child process (so the already-imported, already-initialized `db`
 * module in this test runner's own process can't mask the bug) with DB_PATH/STORAGE_ROOT
 * pointed at directories inside a brand-new, empty temp dir, and asserts that importing
 * `../src/db` alone (the same module server.ts imports statically) does not throw.
 */
test('importing db.ts does not throw when its target directory does not exist yet', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-db-dir-test-'));
  try {
    const dbPath = path.join(tmpRoot, 'fresh-data-dir', 'app.db');
    const storageRoot = path.join(tmpRoot, 'fresh-storage-dir');
    assert.equal(fs.existsSync(path.dirname(dbPath)), false, 'precondition: db dir must not exist yet');
    assert.equal(fs.existsSync(storageRoot), false, 'precondition: storage dir must not exist yet');

    const probeScript = `
      import { db } from ${JSON.stringify(path.join(backendRoot, 'src', 'db.ts'))};
      db.prepare('SELECT 1').get();
      console.log('IMPORT_OK');
    `;
    const probeFile = path.join(tmpRoot, 'probe.mjs');
    await fs.promises.writeFile(probeFile, probeScript, 'utf8');

    const result = spawnSync(tsxBin, [probeFile], {
      cwd: backendRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_PATH: dbPath,
        STORAGE_ROOT: storageRoot,
      },
    });

    assert.equal(result.status, 0, `expected probe script to exit 0, got ${result.status}. stderr:\n${result.stderr}`);
    assert.match(result.stdout, /IMPORT_OK/);
    assert.equal(fs.existsSync(path.dirname(dbPath)), true, 'db.ts should have created its own parent directory');
  } finally {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});
