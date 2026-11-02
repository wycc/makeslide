/**
 * CGU Air as a TTS provider.
 *
 * The CGU Air gateway opened OpenAI's speech models on its OpenAI-compatible `/audio/speech`
 * (gpt-4o-mini-tts, tts-1, tts-1-hd — checked 2026-10-01). So 'cgu-air' is OpenAI's TTS behind a
 * different key and base URL: OpenAI's voice names and request shape, with its own model and
 * speaker settings that fall back to OpenAI's when left empty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import {
  CGU_AIR_DEFAULT_TTS_MODEL,
  globalSpeakerVoicesFor,
  setRuntimeAiSettings,
  speakerPersonasFor,
} from '../src/services/aiSettings';
import { runWithAccountId } from '../src/services/accountContext';
import { invalidateOpenAIClientCache } from '../src/services/openai';
import { estimateTtsCostUsd } from '../src/services/llmUsage';
import { isSupportedVoiceByProvider, TtsPreviewBodySchema, UpdateSystemAiSettingsBodySchema } from '../src/routes/pdfs/shared';
import { synthesizeScriptToFile, ttsModelLabelFor } from '../src/worker/steps/synthesizeAudio';

const SPEAKER_SETTINGS = {
  geminiTtsSpeaker1Voice: 'Kore', geminiTtsSpeaker2Voice: 'Puck',
  openaiTtsSpeaker1Voice: 'nova', openaiTtsSpeaker2Voice: 'onyx',
  openrouterTtsSpeaker1Voice: '', openrouterTtsSpeaker2Voice: '',
  cguAirTtsSpeaker1Voice: '', cguAirTtsSpeaker2Voice: '',
  audiocppTtsSpeaker1Voice: '', audiocppTtsSpeaker2Voice: '',
  geminiTtsSpeaker1: 'g1', geminiTtsSpeaker2: 'g2',
  openaiTtsSpeaker1: '溫和的老師', openaiTtsSpeaker2: '好奇的學生',
  openrouterTtsSpeaker1: '', openrouterTtsSpeaker2: '',
  cguAirTtsSpeaker1: '', cguAirTtsSpeaker2: '',
  audiocppTtsSpeaker1: '', audiocppTtsSpeaker2: '',
};

test('cgu-air voices and personas fall back to OpenAI\'s, per speaker', () => {
  assert.deepEqual(globalSpeakerVoicesFor('cgu-air', SPEAKER_SETTINGS), { speaker1Voice: 'nova', speaker2Voice: 'onyx' });
  assert.deepEqual(speakerPersonasFor('cgu-air', SPEAKER_SETTINGS), { speaker1Persona: '溫和的老師', speaker2Persona: '好奇的學生' });
  const own = { ...SPEAKER_SETTINGS, cguAirTtsSpeaker2Voice: 'coral', cguAirTtsSpeaker1: '主持人' };
  assert.deepEqual(globalSpeakerVoicesFor('cgu-air', own), { speaker1Voice: 'nova', speaker2Voice: 'coral' });
  assert.deepEqual(speakerPersonasFor('cgu-air', own), { speaker1Persona: '主持人', speaker2Persona: '好奇的學生' });
});

test('cgu-air model label defaults to gpt-4o-mini-tts and does not borrow OpenAI\'s model', () => {
  const runtime = { geminiTtsModel: 'g', openaiTtsModel: 'tts-1', cguAirTtsModel: '', openrouterTtsModel: 'o', audiocppTtsModel: '', audiocppTtsFamily: '' };
  assert.equal(ttsModelLabelFor('cgu-air', runtime), CGU_AIR_DEFAULT_TTS_MODEL);
  assert.equal(CGU_AIR_DEFAULT_TTS_MODEL, 'gpt-4o-mini-tts');
  assert.equal(ttsModelLabelFor('cgu-air', { ...runtime, cguAirTtsModel: ' tts-1-hd ' }), 'tts-1-hd');
  assert.equal(ttsModelLabelFor('openai', runtime), 'tts-1');
});

test('cgu-air is accepted wherever a TTS provider is chosen, and takes OpenAI voice names', () => {
  assert.equal(UpdateSystemAiSettingsBodySchema.safeParse({ tts_provider: 'cgu-air', secondary_tts_provider: 'cgu-air', cgu_air_tts_model: 'tts-1' }).success, true);
  assert.equal(TtsPreviewBodySchema.safeParse({ provider: 'cgu-air' }).success, true);
  assert.equal(isSupportedVoiceByProvider('cgu-air', 'nova'), true);
  assert.equal(isSupportedVoiceByProvider('cgu-air', 'Kore'), false);
  assert.ok(estimateTtsCostUsd('cgu-air', 'gpt-4o-mini-tts', 1_000_000) > 0);
});

/** A short, valid MP3 for the fake gateway to answer with — ffmpeg has to be able to read it. */
function toneMp3(dir: string): Buffer {
  const out = path.join(dir, 'tone.mp3');
  const r = spawnSync(ffmpegStatic as unknown as string, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000', '-t', '0.3', '-q:a', '9', out]);
  assert.equal(r.status, 0, r.stderr?.toString());
  return fs.readFileSync(out);
}

test('a dual-host page on cgu-air goes to the CGU base URL, one OpenAI-shaped request per speaker', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgu-air-tts-'));
  const mp3 = toneMp3(dir);
  const requests: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      requests.push({ url: req.url ?? '', auth: String(req.headers.authorization ?? ''), body: JSON.parse(raw || '{}') });
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.end(mp3);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const accountId = 'cgu-air-tts-test-01';
  try {
    setRuntimeAiSettings(accountId, {
      ttsProvider: 'cgu-air',
      secondaryTtsProvider: '',
      cguAirApiKey: 'sk-cgu-air-test',
      cguAirBaseUrl: `http://127.0.0.1:${port}/cgullmapi/v1`,
      cguAirTtsModel: '',
      cguAirTtsSpeaker1Voice: '',
      cguAirTtsSpeaker2Voice: 'coral',
      cguAirTtsSpeaker1: '',
      cguAirTtsSpeaker2: '',
      openaiApiKey: 'sk-openai-must-not-be-used',
      openaiTtsModel: 'tts-1',
      openaiTtsSpeaker1Voice: 'nova',
      openaiTtsSpeaker2Voice: 'onyx',
      openaiTtsSpeaker1: '溫和的老師',
      openaiTtsSpeaker2: '',
    });
    invalidateOpenAIClientCache(accountId, 'cgu-air');
    const target = path.join(dir, 'out.m4a');
    const result = await runWithAccountId(accountId, () => synthesizeScriptToFile({
      pdfId: 'cgu-air-tts-test',
      pageNumber: 1,
      pageUid: 'cgu-air-tts-test-page',
      // The format the script step writes for per-segment providers (generateScript.ts).
      script: '[[ 溫和、平穩 ]]Speaker 1: 大家好，今天來談光合作用。\n[[ 好奇、上揚 ]]Speaker 2: 聽起來很有趣！',
      targetPath: target,
      voice: 'alloy',
    }));
    assert.equal(result.skipped, false, result.error ?? '');
    assert.ok(fs.statSync(target).size > 0);

    assert.equal(requests.length, 2, '兩位講者各一段');
    for (const r of requests) {
      assert.equal(r.url, '/cgullmapi/v1/audio/speech');
      assert.equal(r.auth, 'Bearer sk-cgu-air-test', '用 CGU Air 的 key，不是 OpenAI 的');
      assert.equal(r.body.model, 'gpt-4o-mini-tts', '沒設 CGU 模型時用預設，不借 OpenAI 的 tts-1');
      assert.equal(r.body.response_format, 'mp3');
      assert.ok(!String(r.body.input).includes('Speaker'), '講者標籤要拿掉，否則會被唸出來');
    }
    assert.deepEqual(requests.map((r) => r.body.voice), ['nova', 'coral'], 'Speaker 1 沿用 OpenAI 的聲音，Speaker 2 用 CGU 自己的');
    assert.match(String(requests[0]!.body.instructions ?? ''), /溫和的老師/, '人設沿用 OpenAI 的，經 instructions 送出');
    assert.match(String(requests[1]!.body.instructions ?? ''), /好奇、上揚/, '每段的語氣也經 instructions 送出');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
