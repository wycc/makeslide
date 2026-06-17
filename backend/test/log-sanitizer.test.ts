import test from 'node:test';
import assert from 'node:assert/strict';
import { redactLogObject, redactPromptForLog, redactTextForLog } from '../src/services/logSanitizer';

test('redactLogObject masks API keys, prompt fields and large binary-like payloads', () => {
  const redacted = redactLogObject({
    apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
    authorization: 'Bearer sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
    prompt: '請依照我的私人提示產生簡報，包含未公開的課程安排與客戶名稱',
    rawContent: 'raw response body that should not be logged verbatim',
    image: {
      b64_json: 'a'.repeat(512),
      hex: 'ab'.repeat(128),
    },
    latencyMs: 123,
    requestId: 'req_123',
  });

  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes('sk-proj-abcdefghijklmnopqrstuvwxyz1234567890'), false);
  assert.equal(serialized.includes('未公開的課程安排'), false);
  assert.equal(serialized.includes('raw response body that should not be logged verbatim'), false);
  assert.equal(serialized.includes('a'.repeat(512)), false);
  assert.equal(serialized.includes('ab'.repeat(128)), false);
  assert.equal((redacted as { latencyMs: number }).latencyMs, 123);
  assert.equal((redacted as { requestId: string }).requestId, 'req_123');
});

test('redactPromptForLog and redactTextForLog keep only metadata-friendly summaries', () => {
  const prompt = redactPromptForLog('系統提示：' + '內容'.repeat(200));
  const text = redactTextForLog('short segment');

  assert.deepEqual(prompt?.redacted, true);
  assert.equal(prompt?.chars, 405);
  assert.deepEqual(text, { redacted: true, chars: 13, preview: 'short segment' });
});
