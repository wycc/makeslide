/**
 * BreezeTTS 2 vocal events: written into the script when Breeze reads it, performed by Breeze,
 * and invisible everywhere else.
 *
 * The tags come from the model card (BreezeBlue/Breeze-TTS-2, "Vocal Events"): (laugh) (cough)
 * (clears throat) (sigh) in English, [笑] [咳嗽] [清嗓子] [叹气] in Chinese — simplified.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  breezeVocalEventsInstruction,
  isBreezeTtsActive,
  normalizeBreezeVocalEvents,
  stripBreezeVocalEvents,
  vocalEventsForProvider,
} from '../src/services/breezeVocalEvents';
import { splitScriptIntoSentences } from '../src/services/textSentences';

const ZH = '這個錯誤很常見 [嘆氣]，我們來看為什麼。[笑] 別擔心。';
const EN = 'This mistake is common (sigh). Let us see why. (laugh) Do not worry.';

test('Breeze receives the tags, in the exact form it was trained on', () => {
  // A zh-TW script writes 嘆氣; the model only knows 叹气.
  assert.equal(normalizeBreezeVocalEvents('好 [嘆氣] 吧'), '好 [叹气] 吧');
  assert.equal(normalizeBreezeVocalEvents('好【笑】吧'), '好[笑]吧', '全形括號也要轉成模型認得的寫法');
  assert.equal(normalizeBreezeVocalEvents('ok (LAUGH) now'), 'ok (laugh) now');
  assert.equal(vocalEventsForProvider(ZH, 'audiocpp', 'breeze_tts'), '這個錯誤很常見 [叹气]，我們來看為什麼。[笑] 別擔心。');
});

test('every other engine gets the words without the tags', () => {
  // They would be read out — "左括號笑右括號" — and a page keeps its script when the TTS changes.
  for (const [provider, family] of [['openai', ''], ['gemini', ''], ['audiocpp', 'qwen3_tts']] as const) {
    const out = vocalEventsForProvider(ZH, provider, family);
    assert.ok(!/[[\]()]/.test(out.replace(/[，。]/g, '')), `${provider}/${family} 不該收到標記：${out}`);
    assert.match(out, /這個錯誤很常見，我們來看為什麼。 ?別擔心。/);
  }
  assert.equal(stripBreezeVocalEvents(EN), 'This mistake is common. Let us see why. Do not worry.');
});

test('only the four tags are touched — ordinary brackets are text', () => {
  const text = '見公式 (1) 與參考文獻 [3]，以及 (見下頁) 的說明。';
  assert.equal(stripBreezeVocalEvents(text), text);
  assert.equal(normalizeBreezeVocalEvents(text), text);
});

test('subtitles never show a tag, and the sentence split is unchanged by them', () => {
  const sentences = splitScriptIntoSentences(ZH);
  assert.ok(sentences.every((s) => !/\[|\]/.test(s)), `字幕不該出現標記：${sentences.join(' | ')}`);
  assert.deepEqual(sentences, splitScriptIntoSentences('這個錯誤很常見，我們來看為什麼。別擔心。'));
});

test('the subtitle splitter is the same on both sides', () => {
  // Sentence indices drive animation triggers; the two copies must strip exactly the same things.
  const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const pick = (src: string) => [...src.matchAll(/const BREEZE_(?:ZH|EN)_EVENT_RE = .*;/g)].map((m) => m[0]);
  const back = pick(read('../src/services/textSentences.ts'));
  const front = pick(read('../../frontend/src/lib/subtitles.ts'));
  assert.equal(back.length, 2);
  assert.deepEqual(back, front, '前後端的切句規則必須一字不差');
});

test('the prompt lists only the script language\'s own tags', () => {
  const zh = breezeVocalEventsInstruction('zh-TW');
  assert.match(zh, /\[笑\]、\[咳嗽\]、\[清嗓子\]、\[叹气\]/);
  assert.doesNotMatch(zh, /\(laugh\)/, '中文逐字稿不該看到英文標記');
  assert.match(zh, /最多一到兩個/, '要節制');
  const en = breezeVocalEventsInstruction('en');
  assert.match(en, /\(laugh\)、\(cough\)、\(clears throat\)、\(sigh\)/);
  assert.doesNotMatch(en, /\[笑\]/);
});

test('the instruction is only added when Breeze is the one reading', () => {
  assert.equal(isBreezeTtsActive({ ttsProvider: 'audiocpp', audiocppTtsFamily: 'breeze_tts' }), true);
  assert.equal(isBreezeTtsActive({ ttsProvider: 'audiocpp', audiocppTtsFamily: 'qwen3_tts' }), false);
  assert.equal(isBreezeTtsActive({ ttsProvider: 'openai', audiocppTtsFamily: 'breeze_tts' }), false, '選了 Breeze 家族但 TTS 不是 audio.cpp 時不算');
});

test('all three script writers, and the synthesis step, are wired', () => {
  const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  assert.match(read('../src/worker/steps/generateScript.ts'), /isBreezeTtsActive\(runtime\) \? `\\n\\n\$\{breezeVocalEventsInstruction\(runtime\.contentLanguage\)\}`/);
  assert.match(read('../src/services/scriptRewritePrompt.ts'), /return isBreezeTtsActive\(runtime\) \? `\$\{base\}\\n\\n\$\{breezeVocalEventsInstruction/);
  assert.match(read('../src/services/pptx/stepNarration.ts'), /isBreezeTtsActive\(getRuntimeAiSettings\(\)\) \? \[breezeVocalEventsInstruction\(language\)\]/);
  // Per provider, where the provider is final — not once per page before failover can happen.
  assert.match(read('../src/worker/steps/synthesizeAudio.ts'), /const input = vocalEventsForProvider\(params\.input, provider, runtime\.audiocppTtsFamily\)/);
});
