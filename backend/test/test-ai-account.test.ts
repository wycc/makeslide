import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  llmTestAccount,
  runWithTestAiAccount,
  testAiAccountId,
  testAiSettings,
  ttsTestAccount,
} from '../src/services/testAiAccount';
import { currentAccountId, DEFAULT_ACCOUNT_ID } from '../src/services/accountContext';
import { callChatJSON } from '../src/services/openai';
import { synthesizeTtsPreview } from '../src/services/ttsPreview';

// 這個檔案同時是「測試帳號機制本身的測試」與「怎麼用它」的範例。
// 前半段不需要任何 key，永遠會跑；後半段真的打 LLM/TTS，只有在 .env 設了
// TEST_AI_ACCOUNT_ID（且該帳號的 provider 有 key）時才跑，其餘情況一律 skip。

const llm = llmTestAccount();
const tts = ttsTestAccount();

test('沒設定 TEST_AI_ACCOUNT_ID 時，需要真實 API 的測試會被明確地略過而不是失敗', () => {
  if (testAiAccountId()) {
    // 本機有設定：兩個描述都要指向同一個帳號，理由欄位才不會誤導。
    assert.equal(llm.accountId, testAiAccountId());
    assert.equal(tts.accountId, testAiAccountId());
    return;
  }
  for (const availability of [llm, tts]) {
    assert.equal(availability.available, false);
    assert.equal(availability.provider, null);
    assert.equal(availability.accountId, null);
    assert.match(availability.reason, /TEST_AI_ACCOUNT_ID/, '略過的理由要講清楚怎麼啟用');
  }
});

test('runWithTestAiAccount 會把帳號情境換成測試帳號', () => {
  const expected = testAiAccountId() ?? DEFAULT_ACCOUNT_ID;
  runWithTestAiAccount(() => {
    assert.equal(currentAccountId(), expected);
  });
  // 出了情境就回到預設帳號，不會外洩到後續測試。
  assert.equal(currentAccountId(), DEFAULT_ACCOUNT_ID);
});

test('testAiSettings 讀的是測試帳號自己的設定', () => {
  const settings = testAiSettings();
  if (!testAiAccountId()) {
    assert.equal(settings, null);
    return;
  }
  assert.ok(settings, '設定了測試帳號就該讀得到設定');
  // 情境內外讀到的必須是同一份，否則被測程式碼在情境中拿到的會是別的帳號。
  runWithTestAiAccount(() => {
    assert.deepEqual(testAiSettings(), settings);
  });
});

// ── 以下是「怎麼在測試裡用真的 LLM/TTS」的範例 ─────────────────────────────────

test(
  '（範例）用測試帳號真的呼叫一次 LLM',
  { skip: llm.available ? false : llm.reason, timeout: 120_000 },
  async () => {
    const result = await runWithTestAiAccount(() =>
      callChatJSON({
        messages: [
          { role: 'system', content: 'Reply with JSON only.' },
          { role: 'user', content: 'Return {"ok": true}.' },
        ],
        schema: z.object({ ok: z.boolean() }),
        maxTokens: 32,
        label: 'test-ai-account smoke',
      }),
    );
    assert.equal(result.data.ok, true);
  },
);

test(
  '（範例）用測試帳號真的合成一段語音',
  { skip: tts.available ? false : tts.reason, timeout: 120_000 },
  async () => {
    const provider = tts.provider;
    assert.ok(provider);
    const preview = await runWithTestAiAccount(() =>
      synthesizeTtsPreview({ provider, speaker: '1', voice: '', persona: '' }),
    );
    assert.ok(preview.audio.length > 0, '合成出來的音訊不該是空的');
  },
);
