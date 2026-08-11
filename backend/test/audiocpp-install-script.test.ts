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

/** Fake toolchain entries for the prerequisite tests: `--version` output is all the script reads. */
const FAKE = {
  cmakeOld: '#!/bin/bash\necho "cmake version 3.16.3"\n',
  cmakeNew: '#!/bin/bash\necho "cmake version 3.28.1"\n',
  // GCC 9/10: has <charconv> but not the floating-point overload, so the probe fails to compile.
  cxxNoFloatToChars: '#!/bin/bash\nfor a in "$@"; do [ "$a" = "-fsyntax-only" ] && exit 1; done\necho "c++ (GCC) 9.4.0"\n',
  cxxOk: '#!/bin/bash\necho "c++ (GCC) 12.4.0"\nexit 0\n',
  nvccOld: '#!/bin/bash\necho "Cuda compilation tools, release 11.5, V11.5.50"\n',
  nvccNew: '#!/bin/bash\necho "Cuda compilation tools, release 12.4, V12.4.131"\n',
  smiOld: '#!/bin/bash\necho "495.29.05"\n',
  smiNew: '#!/bin/bash\necho "570.133.07"\n',
};

/** Run the prerequisite check for one backend and report what it decided. */
function runPrereqs(bin: Record<string, string>, backend = 'cuda'): { out: string; rc: number; backend: string } {
  const sandbox = makeSandbox('TTS_PROVIDER=audiocpp\n', bin);
  const out = runScript(sandbox, `audiocpp_check_build_prereqs ${backend} 2>&1; echo "RC=$?"; echo "BACKEND=$AUDIOCPP_BUILD_BACKEND"`);
  fs.rmSync(sandbox.dir, { recursive: true, force: true });
  return {
    out,
    rc: Number(/RC=(\d+)/.exec(out)?.[1] ?? -1),
    backend: /BACKEND=(\w+)/.exec(out)?.[1] ?? '',
  };
}

test('version comparison handles the shapes both a driver and nvcc report', () => {
  const sandbox = makeSandbox('');
  const ge = (a: string, b: string): boolean =>
    runScript(sandbox, `audiocpp_version_ge "${a}" "${b}"; echo $?`).trim() === '0';
  assert.ok(ge('3.31.6', '3.20'));
  assert.ok(!ge('3.16.3', '3.20'));
  assert.ok(ge('12.4', '12.0'));
  assert.ok(!ge('11.5', '12.0'));
  // Driver strings are four digits with a leading zero in the last field — 10# or it is read as octal.
  assert.ok(ge('570.133.07', '525'));
  assert.ok(!ge('495.29.05', '525'));
  assert.ok(ge('525', '525'));
  fs.rmSync(sandbox.dir, { recursive: true, force: true });
});

test('a cmake older than audio.cpp requires stops the build before anything is cloned', () => {
  // The whole point of checking versions up front: this machine cannot build, and finding that
  // out after a clone plus ten minutes of compiling helps nobody.
  const r = runEnsure({
    env: 'TTS_PROVIDER=audiocpp\n',
    bin: { git: '', cmake: FAKE.cmakeOld, 'c++': FAKE.cxxOk },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /cmake 3\.16\.3 太舊/);
  assert.match(r.stdout, /pip install --user/);
  assert.ok(!fs.existsSync(path.join(r.dir, '.audiocpp')), 'nothing may be cloned on this path');
});

test('a compiler without floating-point std::to_chars is rejected up front', () => {
  // What actually happened on Ubuntu 20.04 (g++-9): the build ran to 258/704 and then failed on
  // std::chars_format in src/framework/debug/trace.cpp.
  const r = runEnsure({
    env: 'TTS_PROVIDER=audiocpp\n',
    bin: { git: '', cmake: FAKE.cmakeNew, 'c++': FAKE.cxxNoFloatToChars },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /std::to_chars/);
  assert.ok(!fs.existsSync(path.join(r.dir, '.audiocpp')), 'nothing may be cloned on this path');
});

test('$CXX wins over the system compiler, so a hand-installed toolchain is not overruled', () => {
  // Installing a newer GCC beside the system one and exporting CXX is the fix we print above;
  // checking /usr/bin/c++ anyway would reject the very environment that fix creates.
  const r = runPrereqs(
    { cmake: FAKE.cmakeNew, 'c++': FAKE.cxxNoFloatToChars, 'g++-12': FAKE.cxxOk, nvcc: FAKE.nvccNew, 'nvidia-smi': FAKE.smiNew },
    'cpu',
  );
  assert.match(r.out, /std::to_chars/, 'precondition: the system compiler is the bad one');
  const withCxx = makeSandbox('');
  for (const [name, body] of Object.entries({ cmake: FAKE.cmakeNew, 'c++': FAKE.cxxNoFloatToChars, 'g++-12': FAKE.cxxOk })) {
    fs.writeFileSync(path.join(withCxx.binDir, name), body, { mode: 0o755 });
  }
  const out = runScript(withCxx, 'audiocpp_check_build_prereqs cpu 2>&1; echo "RC=$?"', { CXX: 'g++-12' });
  assert.match(out, /RC=0/, `expected $CXX to be accepted, got:\n${out}`);
  fs.rmSync(withCxx.dir, { recursive: true, force: true });
});

test('a CUDA toolkit older than 12.0 builds on the CPU instead of failing', () => {
  // find_package(CUDAToolkit 12.0 REQUIRED) would fail at configure time; a CPU engine is worth
  // more than no engine, and this is the same reasoning as the runtime GPU fallback.
  const r = runPrereqs({ cmake: FAKE.cmakeNew, 'c++': FAKE.cxxOk, nvcc: FAKE.nvccOld, 'nvidia-smi': FAKE.smiNew });
  assert.equal(r.rc, 0);
  assert.equal(r.backend, 'cpu');
  assert.match(r.out, /CUDA Toolkit 11\.5/);
});

test('a driver too old for CUDA 12 also drops the build to the CPU', () => {
  // This one compiles fine and then loses at runtime: ggml_cuda_init reports "driver version is
  // insufficient" and every segment falls back — GPU build time spent for CPU speed.
  const r = runPrereqs({ cmake: FAKE.cmakeNew, 'c++': FAKE.cxxOk, nvcc: FAKE.nvccNew, 'nvidia-smi': FAKE.smiOld });
  assert.equal(r.rc, 0);
  assert.equal(r.backend, 'cpu');
  assert.match(r.out, /驅動 495\.29\.05 太舊/);
});

test('a machine that meets every threshold keeps the CUDA backend', () => {
  const r = runPrereqs({ cmake: FAKE.cmakeNew, 'c++': FAKE.cxxOk, nvcc: FAKE.nvccNew, 'nvidia-smi': FAKE.smiNew });
  assert.equal(r.rc, 0);
  assert.equal(r.backend, 'cuda');
});

test('the CUDA thresholds are not consulted for a CPU build', () => {
  // No nvcc, no nvidia-smi: a CPU build must not care.
  const r = runPrereqs({ cmake: FAKE.cmakeNew, 'c++': FAKE.cxxOk }, 'cpu');
  assert.equal(r.rc, 0);
  assert.equal(r.backend, 'cpu');
  assert.ok(!r.out.includes('CUDA'), `CPU build mentioned CUDA:\n${r.out}`);
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
