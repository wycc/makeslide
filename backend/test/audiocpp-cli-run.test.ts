import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { AUDIOCPP_VOICE_DESIGN, synthesizeAudioCppSpeech, type AudioCppSettings } from '../src/services/audiocpp';
import { parseWavPcmChunk } from '../src/services/wav';

// End-to-end over the CLI transport, against a stand-in for audiocpp_cli. The argument building
// is covered by pure tests in audiocpp.test.ts; what only a real spawn can show is that the
// process is actually run, that the WAV it writes is picked up, and — the part that matters most
// on a machine without a working GPU — that a failed GPU run is retried on the CPU.

/**
 * A fake `audiocpp_cli`: writes a one-sample WAV to whatever `--out` says and exits 0, unless the
 * requested `--backend` is in `failFor`, in which case it prints a CUDA-style error and exits 1.
 * Records every invocation's backend to `logPath`, one per line.
 */
function writeFakeCli(dir: string, failFor: string[], logPath: string): string {
  const binPath = path.join(dir, 'fake_audiocpp_cli.sh');
  const script = `#!/usr/bin/env bash
backend=""
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --backend) backend="$2"; shift 2;;
    --out) out="$2"; shift 2;;
    *) shift;;
  esac
done
echo "$backend" >> "${logPath}"
for bad in ${failFor.map((b) => `"${b}"`).join(' ')}; do
  if [ "$backend" = "$bad" ]; then
    echo "CUDA error: no CUDA-capable device is detected" >&2
    exit 1
  fi
done
# 44-byte WAV header + 2 bytes of PCM, written with printf escapes.
printf 'RIFF\\x26\\x00\\x00\\x00WAVEfmt \\x10\\x00\\x00\\x00\\x01\\x00\\x01\\x00\\x40\\x1f\\x00\\x00\\x80\\x3e\\x00\\x00\\x02\\x00\\x10\\x00data\\x02\\x00\\x00\\x00\\x01\\x00' > "$out"
exit 0
`;
  fs.writeFileSync(binPath, script, { mode: 0o755 });
  return binPath;
}

function settingsFor(binPath: string, backend: string, overrides: Partial<AudioCppSettings> = {}): AudioCppSettings {
  return {
    mode: 'cli',
    baseUrl: '',
    binPath,
    model: '/models/fake',
    family: 'pocket_tts',
    backend: backend as AudioCppSettings['backend'],
    language: '',
    ...overrides,
  };
}

/** A fake CLI that records the `--task` and `--text` it was given, one call per line. */
function writeTextLoggingCli(dir: string, logPath: string): string {
  const binPath = path.join(dir, 'fake_text_cli.sh');
  fs.writeFileSync(binPath, `#!/usr/bin/env bash
task=""; text=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --task) task="$2"; shift 2;;
    --text) text="$2"; shift 2;;
    --out) out="$2"; shift 2;;
    *) shift;;
  esac
done
echo "$task|$text" >> "${logPath}"
printf 'RIFF\\x26\\x00\\x00\\x00WAVEfmt \\x10\\x00\\x00\\x00\\x01\\x00\\x01\\x00\\x40\\x1f\\x00\\x00\\x80\\x3e\\x00\\x00\\x02\\x00\\x10\\x00data\\x02\\x00\\x00\\x00\\x01\\x00' > "$out"
exit 0
`, { mode: 0o755 });
  return binPath;
}

test('a designed voice is fed Simplified characters, because Traditional comes out Cantonese', async () => {
  // Verified by ear on this machine: same sentence, same instruction, same seed — Traditional
  // gives Cantonese, Simplified gives Mandarin, and saying 「說標準普通話」 does not override it.
  // Only the engine's copy changes; the deck's own text stays Traditional for subtitles.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiocpp-simplify-test-'));
  try {
    const logPath = path.join(dir, 'calls.log');
    const bin = writeTextLoggingCli(dir, logPath);
    const settings = settingsFor(bin, 'cpu', { family: 'qwen3_tts', language: 'chinese' });
    await synthesizeAudioCppSpeech({
      text: '今天我們要談的是系統架構與效能評估。',
      voice: AUDIOCPP_VOICE_DESIGN,
      persona: '沉穩的中年男聲',
      settings,
    });
    // A packaged speaker has no such problem, so its text must arrive untouched.
    await synthesizeAudioCppSpeech({
      text: '今天我們要談的是系統架構與效能評估。',
      voice: 'vivian',
      settings,
    });
    const [designed, packaged] = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    assert.equal(designed, 'vdes|今天我们要谈的是系统架构与效能评估。');
    assert.equal(packaged, 'tts|今天我們要談的是系統架構與效能評估。');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the CLI transport runs the binary and returns the WAV it wrote', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiocpp-cli-test-'));
  try {
    const logPath = path.join(dir, 'calls.log');
    const bin = writeFakeCli(dir, [], logPath);
    const audio = await synthesizeAudioCppSpeech({
      text: '大家好',
      voice: 'alba',
      settings: settingsFor(bin, 'cpu'),
    });
    const parsed = parseWavPcmChunk(audio);
    assert.ok(parsed, 'expected a parseable WAV back');
    assert.equal(parsed.sampleRate, 8000);
    assert.equal(fs.readFileSync(logPath, 'utf8').trim(), 'cpu');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a GPU backend that fails is retried on the CPU instead of failing the page', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiocpp-cli-test-'));
  try {
    const logPath = path.join(dir, 'calls.log');
    const bin = writeFakeCli(dir, ['cuda'], logPath);
    const audio = await synthesizeAudioCppSpeech({
      text: '大家好',
      voice: '',
      settings: settingsFor(bin, 'cuda'),
    });
    assert.ok(parseWavPcmChunk(audio), 'expected the CPU retry to produce audio');
    // Order matters: the configured backend is tried first, the CPU only as the rescue.
    assert.deepEqual(fs.readFileSync(logPath, 'utf8').trim().split('\n'), ['cuda', 'cpu']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failure that is not about hardware is reported, not retried', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiocpp-cli-test-'));
  try {
    const logPath = path.join(dir, 'calls.log');
    // Failing on 'cpu' too means the second run cannot succeed either; the point here is that the
    // error text ("no CUDA-capable device") is what triggers a retry, and a cpu run has nowhere
    // left to fall back to — so exactly one invocation must happen.
    const bin = writeFakeCli(dir, ['cpu'], logPath);
    await assert.rejects(
      synthesizeAudioCppSpeech({ text: 'hi', voice: '', settings: settingsFor(bin, 'cpu') }),
      /exited with code 1/,
    );
    assert.equal(fs.readFileSync(logPath, 'utf8').trim(), 'cpu');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing binary is reported as "install/configure it", not retried ten times', async () => {
  // ENOENT from spawn is a setup problem: the retry loop in synthesizeAudio would otherwise spend
  // ten attempts and ~40 s per page discovering the same thing.
  await assert.rejects(
    synthesizeAudioCppSpeech({
      text: 'hi',
      voice: '',
      settings: settingsFor('/nonexistent/audiocpp_cli', 'cpu'),
    }),
    (err: Error & { status?: number }) => {
      assert.equal(err.status, 424);
      assert.match(err.message, /找不到 audio\.cpp 執行檔/);
      return true;
    },
  );
});

test('the server transport posts an OpenAI-shaped body and returns the audio body', async () => {
  const received: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(body) as unknown });
      res.writeHead(200, { 'content-type': 'audio/wav' });
      res.end(Buffer.from('RIFF....WAVE'));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const audio = await synthesizeAudioCppSpeech({
      text: 'hello',
      voice: 'alba',
      settings: {
        mode: 'server',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        binPath: 'audiocpp_cli',
        model: 'pocket-tts',
        family: '',
        backend: 'auto',
      },
    });
    assert.equal(audio.toString(), 'RIFF....WAVE');
    assert.equal(received.length, 1);
    assert.equal(received[0]!.url, '/v1/audio/speech');
    assert.deepEqual(received[0]!.body, {
      model: 'pocket-tts',
      input: 'hello',
      voice: 'alba',
      response_format: 'wav',
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a server that is not running says which address was tried', async () => {
  // "fetch failed" on its own gives no hint that the local server simply is not up.
  const server = http.createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await assert.rejects(
    synthesizeAudioCppSpeech({
      text: 'hi',
      voice: '',
      settings: {
        mode: 'server',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        binPath: 'audiocpp_cli',
        model: 'pocket-tts',
        family: '',
        backend: 'auto',
      },
    }),
    (err: Error & { status?: number }) => {
      assert.equal(err.status, 424);
      assert.match(err.message, new RegExp(`127\\.0\\.0\\.1:${port}/v1/audio/speech`));
      return true;
    },
  );
});

test('no model configured is a clear message rather than a CLI error', async () => {
  await assert.rejects(
    synthesizeAudioCppSpeech({
      text: 'hi',
      voice: '',
      settings: { ...settingsFor('audiocpp_cli', 'cpu'), model: '' },
    }),
    /尚未設定模型/,
  );
});
