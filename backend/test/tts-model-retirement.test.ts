import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPENROUTER_DEFAULT_TTS_MODEL,
  currentTtsModel,
  isRetiredTtsModel,
  retiredTtsModelReplacement,
  ttsModelErrorHint,
} from '../src/services/ttsModelRetirement';
import { config } from '../src/config';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the retired OpenRouter Gemini TTS models are replaced with the current one', () => {
  // 2026-09-06 對 OpenRouter 實測：舊名回 `400 … does not exist`，新名回 200 audio/pcm。
  assert.equal(currentTtsModel('google/gemini-2.5-flash-preview-tts'), OPENROUTER_DEFAULT_TTS_MODEL);
  assert.equal(currentTtsModel('google/gemini-2.5-pro-preview-tts'), OPENROUTER_DEFAULT_TTS_MODEL);
  assert.equal(isRetiredTtsModel('google/gemini-2.5-flash-preview-tts'), true);
  assert.equal(retiredTtsModelReplacement('google/gemini-2.5-flash-preview-tts'), OPENROUTER_DEFAULT_TTS_MODEL);
});

test('a model that still works is left exactly as configured', () => {
  // 這是在改使用者的設定，所以只換證實不存在的那幾個。Google 直連的 2.5 沒有被 Google 退役，
  // 換掉它會無故改變旁白的音色。
  for (const model of [
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
    OPENROUTER_DEFAULT_TTS_MODEL,
    'gpt-4o-mini-tts',
    'some/future-model',
  ]) {
    assert.equal(currentTtsModel(model), model);
    assert.equal(isRetiredTtsModel(model), false);
    assert.equal(retiredTtsModelReplacement(model), null);
  }
});

test('an empty setting stays empty, because that means "use the default"', () => {
  for (const value of ['', '   ', null, undefined]) {
    assert.equal(currentTtsModel(value), '');
    assert.equal(retiredTtsModelReplacement(value), null);
  }
});

test('the configured value is trimmed before it is matched', () => {
  assert.equal(currentTtsModel('  google/gemini-2.5-flash-preview-tts  '), OPENROUTER_DEFAULT_TTS_MODEL);
});

test('the OpenRouter TTS default is the model that actually exists', () => {
  assert.equal(config.openrouterTtsModel, OPENROUTER_DEFAULT_TTS_MODEL);
  assert.equal(isRetiredTtsModel(config.openrouterTtsModel), false);
});

test('the settings page tells users the same default the backend actually uses', () => {
  // 這次的 bug 有一半是這個漂移：設定頁的 placeholder 與說明從第一版就寫 3.1，後端預設卻是
  // 2.5，所以「留空用預設」拿到的是一個 OpenRouter 已經沒有的模型。
  const files = [
    'frontend/src/locales/en.ts',
    'frontend/src/locales/zh-TW.ts',
    'frontend/src/pages/SettingsPage.tsx',
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    const viaOpenRouter = [...text.matchAll(/google\/gemini-[\w.-]+/g)].map((m) => m[0]);
    const direct = [...text.matchAll(/(?<!\/)\bgemini-[\w.]*tts[\w.-]*/g)].map((m) => m[0]);
    assert.ok(viaOpenRouter.length + direct.length > 0, `${rel} 應該提到 TTS 模型`);
    for (const model of viaOpenRouter) {
      assert.equal(model, config.openrouterTtsModel, `${rel} 提到 ${model}，但後端預設是 ${config.openrouterTtsModel}`);
    }
    for (const model of direct) {
      assert.equal(model, config.geminiTtsModel, `${rel} 提到 ${model}，但後端預設是 ${config.geminiTtsModel}`);
    }
  }
});

test('a missing-model error is turned into something the user can act on', () => {
  const hinted = ttsModelErrorHint({
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash-preview-tts',
    message: '400: Model google/gemini-2.5-flash-preview-tts does not exist',
  });
  assert.ok(hinted.startsWith('400: Model google/gemini-2.5-flash-preview-tts does not exist'));
  assert.ok(hinted.includes('設定頁'));
  assert.ok(hinted.includes(OPENROUTER_DEFAULT_TTS_MODEL));
});

test('other failures are passed through untouched', () => {
  // 金鑰、額度、逾時各有各的處理，加一句「請改模型」只會誤導。
  for (const message of ['401 invalid_api_key: Incorrect API key', '429: rate limited', 'timed out']) {
    assert.equal(ttsModelErrorHint({ provider: 'openrouter', model: 'm', message }), message);
  }
});

test('both places that resolve the OpenRouter TTS model go through the replacement', () => {
  // 環境變數與帳號設定檔是兩條各自獨立的路，漏掉任何一條，存著舊名的那一半就還是會失敗。
  const source = fs.readFileSync(path.join(repoRoot, 'backend/src/services/aiSettings.ts'), 'utf8');
  const assignments = [...source.matchAll(/openrouterTtsModel:\s*([^,\n]+)/g)]
    .map((m) => m[1].trim())
    .filter((value) => value !== 'string;'); // 介面上的型別宣告不是指派
  assert.equal(assignments.length, 2, `預期兩處指派，實際 ${assignments.length}：${assignments.join(' / ')}`);
  for (const assignment of assignments) {
    assert.match(assignment, /usableTtsModel\(/, `這一處沒有換掉已下架的模型：${assignment}`);
  }
});
