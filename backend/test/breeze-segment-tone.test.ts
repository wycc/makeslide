/**
 * Each segment's `[[ 語氣 ]]` reaches BreezeTTS 2, and the voice stays one speaker.
 *
 * The tone used to stop at the audio.cpp branch — only the persona was sent — so a script with a
 * tone per line was read in one flat delivery. Measured on the real engine with the tone sent:
 * at guidance 1 it had no effect, at guidance 4 「放慢」 was the slowest reading on all three
 * seeds tried, and the timbre stayed within what one speaker does naturally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIOCPP_VOICE_DESIGN, buildAudioCppSpeechBody, synthesizeAudioCppSpeech, withSegmentTone, type AudioCppSettings } from '../src/services/audiocpp';
import { runWithAccountId } from '../src/services/accountContext';
import { audioCppVoiceRefDir } from '../src/services/audiocppVoiceRef';
import { breezeScriptInstruction } from '../src/services/breezeVocalEvents';

test('the tone follows the persona, in the script\'s language', () => {
  assert.equal(withSegmentTone('低沉的男聲。', '語速放慢，語氣凝重', 'zh-TW'), '低沉的男聲。這一段的語氣：語速放慢，語氣凝重');
  assert.equal(withSegmentTone('A deep male voice.', 'slower, grave', 'en'), 'A deep male voice. Delivery for this part: slower, grave');
  assert.equal(withSegmentTone('', '語氣輕快', 'zh-TW'), '這一段的語氣：語氣輕快', '沒有人設也要送語氣');
  assert.equal(withSegmentTone('低沉的男聲', '', 'zh-TW'), '低沉的男聲', '沒有語氣就只有人設');
});

/** A stand-in CLI that records the task and the instruction it was given for each run. */
function loggingCli(dir: string, log: string): string {
  const bin = path.join(dir, 'fake_cli.sh');
  fs.writeFileSync(bin, `#!/usr/bin/env bash
task=""; ins=""; guide=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --task) task="$2"; shift 2;;
    --out) out="$2"; shift 2;;
    --request-option)
      case "$2" in instruction=*) ins="\${2#instruction=}";; guidance_scale=*) guide="\${2#guidance_scale=}";; esac
      shift 2;;
    *) shift;;
  esac
done
echo "$task|$guide|$ins" >> "${log}"
printf 'RIFF\\x26\\x00\\x00\\x00WAVEfmt \\x10\\x00\\x00\\x00\\x01\\x00\\x01\\x00\\x40\\x1f\\x00\\x00\\x80\\x3e\\x00\\x00\\x02\\x00\\x10\\x00data\\x02\\x00\\x00\\x00\\x01\\x00' > "$out"
exit 0
`, { mode: 0o755 });
  return bin;
}

test('two segments with two tones: one designed voice, two readings with their own tone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'breeze-tone-'));
  const account = `test-breeze-tone-${process.pid}`;
  try {
    const log = path.join(dir, 'calls.log');
    const settings: AudioCppSettings = {
      mode: 'cli', baseUrl: '', binPath: loggingCli(dir, log), model: path.join(dir, 'breeze.gguf'),
      family: 'breeze_tts', backend: 'cpu', language: '', seed: '',
    };
    const persona = '低沉、磁性、沉穩的成熟男性聲音';
    for (const tone of ['語速放慢，語氣凝重', '語氣輕快，帶點好奇']) {
      await runWithAccountId(account, () => synthesizeAudioCppSpeech({ text: '測試', voice: AUDIOCPP_VOICE_DESIGN, persona, tone, settings }));
    }
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(calls.length, 3, `一次設計＋兩次朗讀，實際：\n${calls.join('\n')}`);
    // The one design run: the persona alone, so a different tone is not a different speaker.
    assert.equal(calls[0], `tts|4|${persona}`);
    // Each reading clones that voice and carries its own tone, with the guidance that makes it heard.
    assert.equal(calls[1], `clon|4|${persona}。這一段的語氣：語速放慢，語氣凝重`);
    assert.equal(calls[2], `clon|4|${persona}。這一段的語氣：語氣輕快，帶點好奇`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.dirname(audioCppVoiceRefDir(account)), { recursive: true, force: true });
  }
});

test('over the speech endpoint the guidance goes along too', () => {
  const body = buildAudioCppSpeechBody({ model: 'breeze', text: 'x', voice: '', persona: '沉穩男聲', family: 'breeze_tts' });
  assert.equal(body.guidance_scale, 4);
  const qwen = buildAudioCppSpeechBody({ model: 'q', text: 'x', voice: 'vivian', persona: '沉穩男聲', family: 'qwen3_tts' });
  assert.equal(qwen.guidance_scale, undefined, 'Qwen3 不受影響');
});

test('the script writer is told to describe the delivery, and that vocal events are allowed', () => {
  const zh = breezeScriptInstruction('zh-TW');
  assert.match(zh, /\[\[ 語速放慢，語氣凝重 \]\]/, '給好的例子');
  assert.match(zh, /\[\[ 核對提問 \]\]/, '也點名不好的寫法');
  assert.match(zh, /\[笑\]/, '聲音事件照舊');
  // The base prompt forbids any markup but [[ ]]; without the exception the two rules contradict.
  assert.match(zh, /本簡報例外，上述聲音事件標記也可以使用/);
  assert.match(breezeScriptInstruction('en'), /\[\[ slower, grave \]\]/);
});

test('the synthesis step hands each segment its tone', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../src/worker/steps/synthesizeAudio.ts', import.meta.url)), 'utf8');
  const call = src.slice(src.indexOf('b = await synthesizeAudioCppSpeech({'), src.indexOf('b = await synthesizeAudioCppSpeech({') + 700);
  assert.match(call, /tone: seg\.instruction,/);
});
