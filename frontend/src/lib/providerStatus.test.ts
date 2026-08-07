import test from 'node:test';
import assert from 'node:assert/strict';
import { toProviderStatus } from './providerStatus';

test('toProviderStatus takes llm_enabled/tts_enabled straight from the backend', () => {
  const status = toProviderStatus({ has_key: true, llm_enabled: true, tts_enabled: false });
  assert.deepEqual(status, { llmEnabled: true, ttsEnabled: false, loaded: true });
});

test('llm_enabled false wins over has_key true (primary key set but provider unusable is still disabled)', () => {
  const status = toProviderStatus({ has_key: true, llm_enabled: false, tts_enabled: true });
  assert.equal(status.llmEnabled, false);
});

test('an older backend without the new fields falls back to has_key and keeps TTS usable', () => {
  // 缺欄位時寧可讓使用者點下去拿到後端的 API_KEY_MISSING，也不要憑空把功能鎖住。
  assert.deepEqual(toProviderStatus({ has_key: false }), { llmEnabled: false, ttsEnabled: true, loaded: true });
  assert.deepEqual(toProviderStatus({ has_key: true }), { llmEnabled: true, ttsEnabled: true, loaded: true });
});
