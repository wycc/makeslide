import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// scripts/audiocpp-install.sh decides whether start.sh should build the local TTS engine. Every
// branch tested here is one that must NOT clone or compile anything — that is the whole point:
// a build is ten-plus minutes, so "should we?" has to be right before "how?" ever runs.
//
// The clone/build path itself is deliberately not exercised (it needs the network and a
// toolchain); what is pinned here is that it is not reached when it should not be.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'audiocpp-install.sh');

/**
 * The utilities the script itself needs, symlinked into each sandbox. Everything NOT on this list
 * — git, cmake, c++ — is therefore absent no matter what the host has installed.
 *
 * This has to be a whitelist rather than `PATH=…:/usr/bin:/bin`: on a developer machine that
 * inherited PATH really does have git and cmake, so the "cannot build" test would sail past its
 * own precondition and the script would go on to clone audio.cpp and start a real compile —
 * minutes of CPU and a repo downloaded into /tmp, from a test whose entire point is that neither
 * happens.
 */
const SANDBOX_TOOLS = ['grep', 'tail', 'sed', 'awk', 'uname', 'getconf', 'mv', 'rm', 'cat', 'mktemp'];

interface RunResult {
  stdout: string;
  status: number;
}

function makeSandbox(envContent: string, bin: Record<string, string> = {}): { dir: string; binDir: string; envPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiocpp-install-test-'));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  for (const tool of SANDBOX_TOOLS) {
    const source = ['/usr/bin', '/bin'].map((d) => path.join(d, tool)).find((p) => fs.existsSync(p));
    if (source) fs.symlinkSync(source, path.join(binDir, tool));
  }
  for (const [name, body] of Object.entries(bin)) {
    fs.writeFileSync(path.join(binDir, name), body || '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  }
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, envContent);
  return { dir, binDir, envPath };
}

function runScript(sandbox: { dir: string; binDir: string; envPath: string }, snippet: string, extraEnv: Record<string, string> = {}): string {
  // /bin/bash by absolute path: PATH holds only the sandbox, so `env bash` would not find a shell.
  return execFileSync('/bin/bash', ['-c', `. "${SCRIPT}"; ${snippet}`], {
    encoding: 'utf8',
    env: {
      PATH: sandbox.binDir,
      MAKESLIDE_ROOT: sandbox.dir,
      AUDIOCPP_ENV_FILE: sandbox.envPath,
      AUDIOCPP_DIR: path.join(sandbox.dir, '.audiocpp'),
      AUDIOCPP_FORCE_INSTALL: '0',
      // Belt and braces: even if a branch decision regressed, a clone from a path that cannot
      // exist fails instantly instead of pulling the real repo into a temp dir.
      AUDIOCPP_REPO: '/nonexistent/audio.cpp.git',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Run `ensure_audiocpp` against a throwaway root and .env. */
function runEnsure(opts: {
  env: string;
  /** Executables to fake, as name → file contents ('' = an empty executable). */
  bin?: Record<string, string>;
  force?: boolean;
  extraEnv?: Record<string, string>;
}): RunResult & { dir: string; envAfter: string } {
  const sandbox = makeSandbox(opts.env, opts.bin ?? {});
  // stderr is folded in because the warnings — the whole output of the "cannot build" paths —
  // go there.
  const stdout = runScript(sandbox, 'ensure_audiocpp 2>&1; echo "EXIT=$?"', {
    ...(opts.force ? { AUDIOCPP_FORCE_INSTALL: '1' } : {}),
    ...opts.extraEnv,
  });
  return {
    stdout,
    status: Number(/EXIT=(\d+)/.exec(stdout)?.[1] ?? -1),
    dir: sandbox.dir,
    envAfter: fs.readFileSync(sandbox.envPath, 'utf8'),
  };
}

test('a deck using a hosted provider is left completely alone', () => {
  // Most installs never touch audio.cpp. Checking (let alone building) unconditionally would make
  // every first ./start.sh wait on a compile for an engine nobody selected.
  const r = runEnsure({ env: 'TTS_PROVIDER=gemini\n' });
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes('檢查 audio.cpp'), `expected no audio.cpp step, got:\n${r.stdout}`);
});

test('selecting audiocpp as the secondary provider is enough to trigger the check', () => {
  // A failover target that turns out not to be installed is discovered mid-run, on the page where
  // the primary provider already failed — the worst possible moment.
  const r = runEnsure({ env: 'TTS_PROVIDER=openai\nSECONDARY_TTS_PROVIDER=audiocpp\n' });
  assert.ok(r.stdout.includes('檢查 audio.cpp'));
});

test('--install-audiocpp checks even when .env selected someone else', () => {
  const r = runEnsure({ env: 'TTS_PROVIDER=openai\n', force: true });
  assert.ok(r.stdout.includes('檢查 audio.cpp'));
});

test('server mode does not build a local binary it will never call', () => {
  const r = runEnsure({
    env: 'TTS_PROVIDER=audiocpp\nAUDIOCPP_TTS_MODE=server\nAUDIOCPP_TTS_BASE_URL=http://127.0.0.1:8080/v1\n',
  });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('server 模式'));
  assert.ok(!r.stdout.includes('下載 audio.cpp 原始碼'));
  assert.ok(!fs.existsSync(path.join(r.dir, '.audiocpp')));
});

test('a base URL alone puts "auto" into server mode, matching the backend', () => {
  // effectiveAudioCppMode() in services/audiocpp.ts resolves auto the same way; if the two
  // disagreed, start.sh would compile an engine the backend then never uses.
  const r = runEnsure({ env: 'TTS_PROVIDER=audiocpp\nAUDIOCPP_TTS_BASE_URL=http://127.0.0.1:8080/v1\n' });
  assert.ok(r.stdout.includes('server 模式'));
});

test('an explicit cli mode ignores a leftover base URL and still wants the binary', () => {
  const r = runEnsure({
    env: 'TTS_PROVIDER=audiocpp\nAUDIOCPP_TTS_MODE=cli\nAUDIOCPP_TTS_BASE_URL=http://127.0.0.1:8080/v1\nAUDIOCPP_AUTO_INSTALL=false\n',
  });
  assert.ok(!r.stdout.includes('server 模式'));
  assert.ok(r.stdout.includes('AUDIOCPP_AUTO_INSTALL=false'));
});

test('an already-installed binary is accepted without building anything', () => {
  const r = runEnsure({
    env: 'TTS_PROVIDER=audiocpp\n',
    bin: { audiocpp_cli: '' },
  });
  assert.ok(r.stdout.includes('已就緒'));
  assert.ok(!r.stdout.includes('下載 audio.cpp 原始碼'));
});

test('a binary already built under .audiocpp is found and written into .env', () => {
  // Without persisting it, the backend would keep looking for `audiocpp_cli` on PATH and report
  // "not installed" right after a successful build.
  const sandbox = makeSandbox('TTS_PROVIDER=audiocpp\nAUDIOCPP_TTS_BIN=\n');
  const buildDir = path.join(sandbox.dir, '.audiocpp', 'build', 'bin');
  fs.mkdirSync(buildDir, { recursive: true });
  const bin = path.join(buildDir, 'audiocpp_cli');
  fs.writeFileSync(bin, '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  runScript(sandbox, 'ensure_audiocpp 2>&1');
  const after = fs.readFileSync(sandbox.envPath, 'utf8');
  assert.match(after, new RegExp(`^AUDIOCPP_TTS_BIN=${bin}$`, 'm'));
  // The line must be replaced, not duplicated — a second one would win on re-read and could
  // disagree with the first.
  assert.equal(after.match(/^AUDIOCPP_TTS_BIN=/gm)?.length, 1);
  fs.rmSync(sandbox.dir, { recursive: true, force: true });
});

test('a hand-set AUDIOCPP_TTS_BIN is never overwritten', () => {
  // Points at something that does not exist, so the script falls through to the .audiocpp build —
  // and must still leave the user's own line alone.
  const sandbox = makeSandbox('TTS_PROVIDER=audiocpp\nAUDIOCPP_TTS_BIN=/opt/mine/audiocpp_cli\n');
  const buildDir = path.join(sandbox.dir, '.audiocpp', 'build', 'bin');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, 'audiocpp_cli'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  runScript(sandbox, 'ensure_audiocpp 2>&1');
  assert.match(fs.readFileSync(sandbox.envPath, 'utf8'), /^AUDIOCPP_TTS_BIN=\/opt\/mine\/audiocpp_cli$/m);
  fs.rmSync(sandbox.dir, { recursive: true, force: true });
});

test('the sandbox really has no toolchain, so the next test tests what it claims', () => {
  // Guarding the precondition itself: with git/cmake on PATH the "cannot build" case below would
  // instead clone the repo and start a real compile, and still pass or hang depending on timing.
  const sandbox = makeSandbox('');
  const found = runScript(
    sandbox,
    'for t in git cmake c++ g++ clang++; do command -v "$t" >/dev/null 2>&1 && echo "$t"; done; echo READY',
  );
  assert.equal(found.trim(), 'READY', `sandbox PATH leaked a toolchain: ${found}`);
  fs.rmSync(sandbox.dir, { recursive: true, force: true });
});

test('missing build tools warn instead of failing the whole startup', () => {
  // TTS is one part of the app; a machine without a compiler should still get MakeSlide running.
  const r = runEnsure({ env: 'TTS_PROVIDER=audiocpp\n', bin: {} });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /缺少建置工具/);
  assert.ok(!fs.existsSync(path.join(r.dir, '.audiocpp')), 'nothing may be cloned on this path');
});

test('a build that cannot even clone still lets MakeSlide start', () => {
  // The one place the script does reach for the network. AUDIOCPP_REPO points at a path that
  // cannot exist, so this exercises the failure handling without downloading anything.
  const r = runEnsure({
    env: 'TTS_PROVIDER=audiocpp\n',
    bin: { git: '#!/bin/bash\necho "fatal: repository not found" >&2\nexit 128\n', cmake: '', 'c++': '' },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /clone audio\.cpp 失敗/);
});

test('AUDIOCPP_AUTO_INSTALL=false disables building but still reports the state', () => {
  const r = runEnsure({ env: 'TTS_PROVIDER=audiocpp\nAUDIOCPP_AUTO_INSTALL=false\n' });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('AUDIOCPP_AUTO_INSTALL=false'));
  assert.ok(!fs.existsSync(path.join(r.dir, '.audiocpp')));
});

test('the build backend is detected the same way the runtime picks one', () => {
  // If the build used a different rule than services/audiocpp.ts, a machine could compile a
  // CPU-only binary and then be asked for CUDA at runtime — every segment would fall back.
  const detect = (env: Record<string, string>): string =>
    execFileSync('/usr/bin/env', ['bash', '-c', `. "${SCRIPT}"; detect_audiocpp_backend`], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', MAKESLIDE_ROOT: '/tmp', ...env },
    }).trim();
  // A hidden GPU means CPU, exactly as detectAudioCppBackend does with CUDA_VISIBLE_DEVICES.
  assert.equal(detect({ CUDA_VISIBLE_DEVICES: '' }), 'cpu');
  assert.equal(detect({ CUDA_VISIBLE_DEVICES: '-1' }), 'cpu');
  // Whatever this machine is, the answer has to be one the CLI accepts.
  assert.ok(['cpu', 'cuda', 'hip', 'metal'].includes(detect({})));
});
