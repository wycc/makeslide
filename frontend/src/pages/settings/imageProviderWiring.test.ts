import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../../locales/zh-TW';
import { en } from '../../locales/en';

// 圖片供應商設定（使用者要求，2026-09-22）：設定頁多一個「圖片供應商」選單（跟著 LLM／OpenAI／
// Gemini／Qwen），各自的圖片模型欄位與 Qwen 金鑰跟著露出，存檔時全部送回。原始碼層級守門。
const SRC = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'SettingsPage.tsx'), 'utf8');

test('the settings page has the image provider select with all four choices and saves every image field', () => {
  assert.match(SRC, /<select value=\{imageProvider\}/);
  for (const v of ['""', '"openai"', '"gemini"', '"qwen"']) assert.match(SRC, new RegExp(`<option value=${v}>`), `option ${v}`);
  for (const key of ['image_provider: imageProvider', 'openai_image_model: openaiImageModel.trim()', 'gemini_image_model: geminiImageModel.trim()', 'qwen_api_key: qwenApiKey.trim()', 'qwen_base_url: qwenBaseUrl.trim()', 'qwen_image_model: qwenImageModel.trim()']) {
    assert.ok(SRC.includes(key), `saved: ${key}`);
  }
  for (const key of ["setImageProvider(s.image_provider ?? '')", "setQwenApiKey(s.qwen_api_key ?? '')", "setGeminiImageModel(s.gemini_image_model ?? '')"]) assert.ok(SRC.includes(key), `loaded: ${key}`);
  assert.match(SRC, /visibleFields\.image\('openai'\)/);
  assert.match(SRC, /visibleFields\.image\('gemini'\)/);
  assert.match(SRC, /visibleFields\.image\('qwen'\)/);
  assert.match(SRC, /visibleFields\.credentials\('qwen'\)/);
  assert.match(SRC, /qwen: Boolean\(s\.has_qwen_key\)/, 'the missing-key suffix works for Qwen too');
  assert.match(SRC, /imageProvider,\s*showAll: showAllProviderFields/, 'visibility knows the pinned image provider');
  // Qwen runs as a separate service by default (this or another machine); DashScope is the alternative.
  assert.match(SRC, /<select value=\{qwenImageBackend\}/);
  assert.match(SRC, /<option value="local">/);
  assert.match(SRC, /<option value="dashscope">/);
  assert.ok(SRC.includes('qwen_image_backend: qwenImageBackend'), 'saved');
  assert.match(SRC, /provider === 'qwen' && qwenImageBackend === 'local'\) return label/, 'no 「缺 key」 suffix for the keyless local service');
  for (const locale of [zhTW, en]) {
    for (const k of ['settings.imageProvider', 'settings.imageProviderAuto', 'settings.imageProviderHint', 'settings.openaiImageModelLabel', 'settings.geminiImageModelLabel', 'settings.qwenImageModelLabel', 'settings.qwenApiKeyHint', 'settings.qwenImageBackend', 'settings.qwenLocalHint', 'settings.qwenApiKeyHintLocal'] as const) {
      assert.equal(typeof locale[k], 'string', k);
    }
  }
});
