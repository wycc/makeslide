import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CJK_CHARS_PER_SECOND,
  WORDS_PER_MINUTE,
  estimateSpeech,
  estimateSpeakingTimeLabel,
  formatSpeakingTime,
  speechCountLabelParts,
  spokenTextOf,
} from './speakingTimeEstimate';

test('Chinese is still counted per character at the original rate', () => {
  const script = '大家好'.repeat(80); // 240 個字
  const estimate = estimateSpeech(script);
  assert.equal(estimate.cjkChars, 240);
  assert.equal(estimate.words, 0);
  assert.equal(estimate.unit, 'chars');
  assert.equal(estimate.seconds, 240 / CJK_CHARS_PER_SECOND);
});

test('English is counted per word, not per character', () => {
  // 這是回報的問題本身：英文一個字平均五、六個字元，除以「每秒 4 個字元」會把時間高估三、
  // 四倍。140 words 應該剛好一分鐘。
  const script = Array.from({ length: WORDS_PER_MINUTE }, () => 'intelligence').join(' ');
  const estimate = estimateSpeech(script);
  assert.equal(estimate.words, WORDS_PER_MINUTE);
  assert.equal(estimate.cjkChars, 0);
  assert.equal(estimate.unit, 'words');
  assert.equal(estimate.seconds, 60);
  // 舊行為會把這 1679 個字元估成 7 分鐘。
  assert.ok(script.length / CJK_CHARS_PER_SECOND > 400);
});

test('numbers count as one word each, however many digits', () => {
  const estimate = estimateSpeech('It started around 541 million years ago.');
  assert.equal(estimate.words, 7);
});

test('what will not be spoken is not counted', () => {
  // 語氣標記與講者標籤在送進 TTS 前就被拿掉了（後端 stripSpokenToneTags / splitSpeakerPrefix），
  // 算進長度只會讓兩個數字都偏大——回報的截圖裡它們佔了可觀的一部分。
  const script = [
    '[[ Curious introduction ]]Speaker 1: So, we are diving in today, right?',
    '',
    '[[ Engaging response ]]Speaker 2: Exactly! It all starts here.',
  ].join('\n');
  const spoken = spokenTextOf(script);
  assert.ok(!spoken.includes('Curious introduction'));
  assert.ok(!spoken.includes('Speaker 1'));
  assert.ok(spoken.startsWith('So, we are diving in today'));
  assert.equal(estimateSpeech(script).words, 12); // 7 + 5，標記與講者標籤都不算
  // 舊版的 {{ … }} 與 Gemini 的單括號英文標籤同樣不算。
  assert.equal(estimateSpeech('{{ 興奮 }}[excitedly] Hello there').words, 2);
});

test('a dual-host English page is estimated in minutes, not tens of minutes', () => {
  // 回歸守門，比照回報的那一頁：約 2500 個字元的英文對話（含標記與講者標籤），舊版顯示
  // 10:25，實際約兩分半。
  const turn = '[[ Engaging response ]]Speaker 2: Exactly, it all starts with the Cambrian explosion, around 541 million years ago.\n';
  const script = turn.repeat(21);
  assert.ok(script.length > 2400 && script.length < 2600, `script length ${script.length}`);
  const estimate = estimateSpeech(script);
  assert.equal(estimate.unit, 'words');
  // 273 個要唸的字 ≈ 1:57。舊版把 2500 個字元除以 4，得到 10:25。
  assert.ok(estimate.seconds > 100 && estimate.seconds < 180, `seconds ${estimate.seconds}`);
  assert.ok(script.length / CJK_CHARS_PER_SECOND > 600);
});

test('mixed text counts each language its own way and says so', () => {
  const script = `${'大家好'.repeat(20)} ${Array.from({ length: 40 }, () => 'transformer').join(' ')}`;
  const estimate = estimateSpeech(script);
  assert.equal(estimate.cjkChars, 60);
  assert.equal(estimate.words, 40);
  assert.equal(estimate.unit, 'mixed');
  assert.equal(estimate.seconds, Math.round(60 / CJK_CHARS_PER_SECOND + 40 / (WORDS_PER_MINUTE / 60)));
});

test('a stray foreign term does not change the unit the label uses', () => {
  // 中文講稿裡的一個專有名詞不該讓那一列變成「N 字 + 1 個英文字」，但它的時間還是要算進去。
  const estimate = estimateSpeech(`${'大家好'.repeat(60)}，這就是 MakeSlide。`);
  assert.equal(estimate.unit, 'chars');
  assert.equal(estimate.words, 1);
  const english = estimateSpeech(`${Array.from({ length: 60 }, () => 'intelligence').join(' ')}，這是重點`);
  assert.equal(english.unit, 'words');
});

test('an empty or blank script is zero, and never NaN', () => {
  for (const script of ['', '   \n  ', '[[ 平穩敘述 ]]']) {
    const estimate = estimateSpeech(script);
    assert.equal(estimate.seconds, 0);
    assert.equal(estimate.cjkChars, 0);
    assert.equal(estimate.words, 0);
    assert.equal(estimate.unit, 'chars');
  }
});

test('speechCountLabelParts picks the key and values for the unit', () => {
  assert.deepEqual(speechCountLabelParts({ cjkChars: 12, words: 0, seconds: 3, unit: 'chars' }), {
    key: 'play.slidePanel.transcript.charCount',
    values: { '{n}': '12' },
  });
  assert.deepEqual(speechCountLabelParts({ cjkChars: 0, words: 9, seconds: 4, unit: 'words' }), {
    key: 'play.slidePanel.transcript.wordCount',
    values: { '{n}': '9' },
  });
  assert.deepEqual(speechCountLabelParts({ cjkChars: 12, words: 9, seconds: 7, unit: 'mixed' }), {
    key: 'play.slidePanel.transcript.mixedCount',
    values: { '{n}': '12', '{w}': '9' },
  });
});

test('formatSpeakingTime formats as m:ss with unpadded minutes', () => {
  assert.equal(formatSpeakingTime(60), '1:00');
  assert.equal(formatSpeakingTime(5), '0:05');
  assert.equal(formatSpeakingTime(125), '2:05');
  assert.equal(formatSpeakingTime(0), '0:00');
  assert.equal(formatSpeakingTime(Number.NaN), '0:00');
  assert.equal(formatSpeakingTime(-40), '0:00');
});

test('estimateSpeakingTimeLabel takes the script itself', () => {
  assert.equal(estimateSpeakingTimeLabel('大家好'.repeat(80)), '1:00');
  assert.equal(estimateSpeakingTimeLabel(''), '0:00');
});
