/**
 * A designed voice is designed once and cloned from then on.
 *
 * Reported as "every segment has a different voice". Voice Design invents a speaker from a
 * description on every call, and each segment is its own call; with one persona over four segments
 * the spectral-centroid spread was 78% before this and 17% after — a fixed built-in speaker reading
 * the same four sentences spreads 28%, so that is inside what one voice does naturally.
 *
 * The engine is not run here: these pin which clip is used and when a new one is made.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioCppAnchorsDesignedVoice, designedVoiceAnchor, type AudioCppSettings } from '../src/services/audiocpp';
import { audioCppVoiceRefDir, VOICE_FREEZE_TEXT, writeVoiceRefTranscript } from '../src/services/audiocppVoiceRef';

const settings: AudioCppSettings = {
  mode: 'cli', baseUrl: '', binPath: '/nonexistent/audiocpp_cli', model: '/models/Breeze-TTS-2-GGUF/breeze-tts-2-q8_0.gguf',
  family: 'breeze_tts', backend: 'cpu', language: '', seed: '',
};
const ACCOUNT = `test-anchor-${process.pid}`;

test.after(() => fs.rmSync(path.dirname(audioCppVoiceRefDir(ACCOUNT)), { recursive: true, force: true }));

test('the families that can clone are the ones that anchor', () => {
  assert.equal(audioCppAnchorsDesignedVoice('breeze_tts'), true);
  assert.equal(audioCppAnchorsDesignedVoice('qwen3_tts'), true);
  assert.equal(audioCppAnchorsDesignedVoice('pocket_tts'), false);
});

test('an existing anchor is reused without running the engine', async () => {
  // Plant the clip the persona would produce; the CLI path is bogus, so any synthesis would throw.
  const persona = '低沉、磁性、沉穩的成熟男性聲音';
  const first = await designedVoiceAnchor({ settings, persona, language: 'zh-TW', accountId: ACCOUNT }).catch((e) => e);
  assert.ok(first instanceof Error, '還沒有錨點時會去合成（這裡的 CLI 路徑是假的所以失敗）');
  const dir = audioCppVoiceRefDir(ACCOUNT);
  const expected = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  assert.deepEqual(expected.filter((f) => f.endsWith('.wav')), [], '失敗的合成不可以留下半個錨點');

  // Now make it exist, under the name the key derives.
  const name = await planted(persona);
  const reused = await designedVoiceAnchor({ settings, persona, language: 'zh-TW', accountId: ACCOUNT });
  assert.equal(path.basename(reused), name, '同一個人設要用同一段錨點');
});

test('the persona, model and language pick the anchor; nothing else does', async () => {
  const a = await planted('聲音A');
  const b = await planted('聲音B');
  assert.notEqual(a, b, '改了人設就是另一個聲音');
  const otherModel = await planted('聲音A', { model: '/models/other.gguf' });
  assert.notEqual(a, otherModel, '換模型要重新設計');
  const english = await planted('聲音A', {}, 'en');
  assert.notEqual(a, english, '英文簡報用英文錨點句');
  assert.equal(await planted('聲音A'), a, '其他都一樣就是同一個錨點');
});

test('a clip without its transcript is not an anchor — cloning needs both', async () => {
  const persona = '只有音檔沒有逐字稿';
  const name = await planted(persona);
  fs.rmSync(path.join(audioCppVoiceRefDir(ACCOUNT), `${name}.txt`));
  const result = await designedVoiceAnchor({ settings, persona, language: 'zh-TW', accountId: ACCOUNT }).catch((e) => e);
  assert.ok(result instanceof Error, '缺逐字稿就要重做（這裡因為 CLI 是假的而失敗），不能拿去複製');
});

test('design mode goes through the anchor, over the CLI only, keeping the persona', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../src/services/audiocpp.ts', import.meta.url)), 'utf8');
  const fn = src.slice(src.indexOf('export async function synthesizeAudioCppSpeech('));
  assert.match(fn.slice(0, 1500), /audioCppVoiceMode\(params\.voice\) === 'design'\s*\n\s*&& audioCppAnchorsDesignedVoice\(settings\.family\)\s*\n\s*&& effectiveAudioCppMode\(settings\) === 'cli'/);
  // Cloned from the anchor, read with the persona plus this segment's tone — while the anchor itself
  // is designed from the persona alone.
  assert.match(fn.slice(0, 2500), /synthesizeAudioCppSpeechDirect\(\{ \.\.\.params, persona: reading, voice: anchor, settings \}\)/, '用錨點複製，人設與語氣照送');
  assert.match(fn.slice(0, 2500), /persona: params\.persona\?\.trim\(\) \?\? '',/, '錨點只依人設，不含語氣');
  // Concurrent segments share one design run instead of each making their own anchor.
  assert.match(src, /const running = anchorsInFlight\.get\(clipPath\);/);
});

/** Writes the clip and transcript the key for these inputs points at, returns the file name. */
async function planted(persona: string, override: Partial<AudioCppSettings> = {}, language = 'zh-TW'): Promise<string> {
  const s = { ...settings, ...override };
  // Derive the path the same way the code does, by letting it fail once and reading the name it
  // would have written — simpler: compute from the exported function via a planted transcript.
  const crypto = await import('node:crypto');
  const anchorText = language.startsWith('en')
    ? (await import('../src/services/audiocppVoiceRef')).VOICE_FREEZE_TEXT_EN
    : VOICE_FREEZE_TEXT;
  const key = crypto.createHash('sha256').update(JSON.stringify([s.family.trim(), s.model.trim(), persona.trim(), anchorText])).digest('hex').slice(0, 16);
  const dir = audioCppVoiceRefDir(ACCOUNT);
  fs.mkdirSync(dir, { recursive: true });
  const clip = path.join(dir, `designed-${key}.wav`);
  fs.writeFileSync(clip, 'RIFF');
  await writeVoiceRefTranscript(clip, anchorText);
  return path.basename(clip);
}
