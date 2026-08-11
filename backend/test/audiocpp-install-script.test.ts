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

interface RunResult {
  stdout: string;
  status: number;
}

/**
 * Run `ensure_audiocpp` against a throwaway root and .env.
 *
 * PATH is replaced with a sandbox bin directory, so what the script finds is exactly what the
 * test put there — including "git/cmake are missing", which is otherwise unrepresentable on a
 * developer machine.
 */
function runEnsure(opts: {
  env: string;
  /** Executables to fake, as name → file contents ('' = an empty executable). */
  bin?: Record<string, string>;
  force?: boolean;
  extraEnv?: Record<string, string>;
}): RunResult & { dir: string; envAfter: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiocpp-install-test-'));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  for (const [name, body] of Object.entries(opts.bin ?? {})) {
    const p = path.join(binDir, name);
    fs.writeFileSync(p, body || '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  }
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, opts.env);
  // stderr is folded in because the warnings — the whole output of the "cannot build" paths —
  // go there. `coreutils` still has to be reachable for the script's own greps/awk.
  const stdout = execFileSync(
    '/usr/bin/env',
    ['bash', '-c', `. "${SCRIPT}"; ensure_audiocpp 2>&1; echo "EXIT=$?"`],
    {
      encoding: 'utf8',
      env: {
        PATH: `${binDir}:/usr/bin:/bin`,
        MAKESLIDE_ROOT: dir,
        AUDIOCPP_ENV_FILE: envPath,
        AUDIOCPP_DIR: path.join(dir, '.audiocpp'),
        AUDIOCPP_FORCE_INSTALL: opts.force ? '1' : '0',
        ...opts.extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return {
    stdout,
    status: Number(/EXIT=(\d+)/.exec(stdout)?.[1] ?? -1),
    dir,
    envAfter: fs.readFileSync(envPath, 'utf8'),
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiocpp-install-test-'));
  const buildDir = path.join(dir, '.audiocpp', 'build', 'bin');
  fs.mkdirSync(buildDir, { recursive: true });
  const bin = path.join(buildDir, 'audiocpp_cli');
  fs.writeFileSync(bin, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, 'TTS_PROVIDER=audiocpp\nAUDIOCPP_TTS_BIN=\n');
  execFileSync('/usr/bin/env', ['bash', '-c', `. "${SCRIPT}"; ensure_audiocpp`], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      MAKESLIDE_ROOT: dir,
      AUDIOCPP_ENV_FILE: envPath,
      AUDIOCPP_DIR: path.join(dir, '.audiocpp'),
      AUDIOCPP_FORCE_INSTALL: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const after = fs.readFileSync(envPath, 'utf8');
  assert.match(after, new RegExp(`^AUDIOCPP_TTS_BIN=${bin}$`, 'm'));
  // The line must be replaced, not duplicated — a second one would win on re-read and could
  // disagree with the first.
  assert.equal(after.match(/^AUDIOCPP_TTS_BIN=/gm)?.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a hand-set AUDIOCPP_TTS_BIN is never overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiocpp-install-test-'));
  const buildDir = path.join(dir, '.audiocpp', 'build', 'bin');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, 'audiocpp_cli'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  const envPath = path.join(dir, '.env');
  // Points at something that does not exist, so the script falls through to the .audiocpp build —
  // and must still leave the user's own line alone.
  fs.writeFileSync(envPath, 'TTS_PROVIDER=audiocpp\nAUDIOCPP_TTS_BIN=/opt/mine/audiocpp_cli\n');
  execFileSync('/usr/bin/env', ['bash', '-c', `. "${SCRIPT}"; ensure_audiocpp`], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      MAKESLIDE_ROOT: dir,
      AUDIOCPP_ENV_FILE: envPath,
      AUDIOCPP_DIR: path.join(dir, '.audiocpp'),
      AUDIOCPP_FORCE_INSTALL: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(fs.readFileSync(envPath, 'utf8'), /^AUDIOCPP_TTS_BIN=\/opt\/mine\/audiocpp_cli$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing build tools warn instead of failing the whole startup', () => {
  // TTS is one part of the app; a machine without a compiler should still get MakeSlide running.
  const r = runEnsure({ env: 'TTS_PROVIDER=audiocpp\n', bin: {} });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('缺少建置工具') || /缺少建置工具/.test(r.stdout), r.stdout);
  assert.ok(!fs.existsSync(path.join(r.dir, '.audiocpp')));
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
