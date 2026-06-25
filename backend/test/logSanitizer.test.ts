import test from 'node:test';
import assert from 'node:assert/strict';
import {
  redactLogValue,
  redactLogObject,
  redactPromptForLog,
  redactTextForLog,
} from '../src/services/logSanitizer';

test('redactLogValue passes through nullish, number, boolean and stringifies bigint', () => {
  assert.equal(redactLogValue(null), null);
  assert.equal(redactLogValue(undefined), undefined);
  assert.equal(redactLogValue(42), 42);
  assert.equal(redactLogValue(true), true);
  assert.equal(redactLogValue(10n), '10');
});

test('redactLogValue scrubs api keys, bearer tokens and data urls inside plain strings', () => {
  assert.equal(
    redactLogValue('token=sk-test1234567890abcdefgh here'),
    'token=[redacted] here',
  );
  assert.equal(
    redactLogValue('Authorization: Bearer abcdef1234567890ghijkl'),
    'Authorization: Bearer [redacted]',
  );
  assert.equal(
    redactLogValue(`data:image/png;base64,${'A'.repeat(64)}`),
    '[redacted-large-content]',
  );
  assert.equal(redactLogValue(`key AIza${'b'.repeat(20)}`), 'key [redacted]');
});

test('redactLogValue collapses very long hex and base64 blobs', () => {
  assert.equal(redactLogValue('a1'.repeat(64)), '[redacted-large-content]');
  assert.equal(redactLogValue('A'.repeat(300)), '[redacted-large-content]');
});

test('redactLogValue truncates long non-sensitive strings preserving the original length', () => {
  const original = 'x '.repeat(200); // 400 chars, no sensitive pattern
  const result = redactLogValue(original) as string;
  assert.equal(result.startsWith(original.slice(0, 256)), true);
  assert.equal(result.endsWith('…[truncated chars=400]'), true);
});

test('redactLogValue summarizes values under sensitive keys', () => {
  // short sensitive value keeps a sanitized preview
  assert.deepEqual(redactLogValue('hunter2', 'password'), {
    redacted: true,
    chars: 7,
    preview: 'hunter2',
  });
  // long sensitive value drops the preview, keeps the char count
  assert.deepEqual(redactLogValue('a'.repeat(30), 'token'), {
    redacted: true,
    chars: 30,
  });
});

test('redactLogValue respects safe metadata keys even when they match the sensitive pattern', () => {
  // hasUrl ends with "url" (matches the pattern) but is whitelisted
  assert.deepEqual(redactLogValue({ hasUrl: true }), { hasUrl: true });
  // a bare "url" key is not whitelisted and gets summarized
  assert.deepEqual(redactLogValue({ url: 'x' }), {
    url: { redacted: true, chars: 1, preview: 'x' },
  });
});

test('redactLogValue redacts buffers and typed arrays into size summaries', () => {
  assert.deepEqual(redactLogValue(Buffer.from('hello')), {
    redacted: true,
    bytes: 5,
    type: 'Buffer',
  });
  assert.deepEqual(redactLogValue(new Uint8Array([1, 2, 3])), {
    redacted: true,
    bytes: 3,
    type: 'Uint8Array',
  });
});

test('redactLogValue reduces Error objects to name and sanitized message', () => {
  const err = new Error('boom sk-test1234567890abcdefgh');
  assert.deepEqual(redactLogValue(err), {
    name: 'Error',
    message: 'boom [redacted]',
  });
});

test('redactLogValue recurses into nested objects and arrays', () => {
  const input = {
    model: 'gpt-4',
    api_key: 'sk-test1234567890abcdefgh',
    nested: { secret: 'topsecret', count: 3 },
    items: [1, 2, 3],
  };
  assert.deepEqual(redactLogValue(input), {
    model: 'gpt-4',
    api_key: { redacted: true, chars: 25 },
    nested: {
      secret: { redacted: true, chars: 9, preview: 'topsecret' },
      count: 3,
    },
    items: [1, 2, 3],
  });
});

test('redactLogValue caps arrays at 20 elements', () => {
  const result = redactLogValue(Array.from({ length: 25 }, (_, i) => i)) as number[];
  assert.equal(result.length, 20);
  assert.equal(result[0], 0);
  assert.equal(result[19], 19);
});

test('redactLogValue stops at the depth limit', () => {
  let deep: Record<string, unknown> = { value: 1 };
  for (let i = 0; i < 8; i++) deep = { a: deep };
  const result = redactLogValue(deep);
  assert.equal(JSON.stringify(result).includes('[redacted-depth-limit]'), true);
});

test('redactLogObject is a typed wrapper over redactLogValue', () => {
  assert.deepEqual(redactLogObject({ count: 2, token: 'short' }), {
    count: 2,
    token: { redacted: true, chars: 5, preview: 'short' },
  });
});

test('redactPromptForLog and redactTextForLog return null for empty input', () => {
  assert.equal(redactPromptForLog(null), null);
  assert.equal(redactPromptForLog(undefined), null);
  assert.equal(redactPromptForLog(''), null);
  assert.equal(redactTextForLog(null), null);
  assert.equal(redactTextForLog(''), null);
});

test('redactPromptForLog and redactTextForLog summarize non-empty prompts', () => {
  assert.deepEqual(redactPromptForLog('hello'), {
    redacted: true,
    chars: 5,
    preview: 'hello',
  });
  assert.deepEqual(redactTextForLog('a'.repeat(50)), {
    redacted: true,
    chars: 50,
  });
});
