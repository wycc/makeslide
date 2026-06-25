import test from 'node:test';
import assert from 'node:assert/strict';
import {
  redactLogValue,
  redactLogObject,
  redactPromptForLog,
  redactTextForLog,
  redactSecretsInText,
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

test('redactLogValue strips credentials embedded in a git remote URL (any token shape)', () => {
  // presentationGit builds https://x-access-token:<token>@github.com remotes; a git
  // error leaking that URL must not expose the token, whatever its format.
  assert.equal(
    redactLogValue('failed to push to https://x-access-token:ghp_abcdEFGH1234567890wxyz@github.com/owner/repo.git'),
    'failed to push to https://[redacted]@github.com/owner/repo.git',
  );
  assert.equal(
    redactLogValue('https://user:github_pat_11ABCDEFG0abcdefghij_KLMNOP@github.com/x/y.git'),
    'https://[redacted]@github.com/x/y.git',
  );
});

test('redactLogValue masks bare GitHub tokens and leaves credential-free URLs intact', () => {
  assert.equal(redactLogValue('token ghp_abcdEFGH1234567890wxyzABCD here'), 'token [redacted] here');
  assert.equal(redactLogValue('clone https://github.com/owner/repo.git'), 'clone https://github.com/owner/repo.git');
  // host:port without credentials must not be redacted
  assert.equal(redactLogValue('connect http://localhost:3000/api'), 'connect http://localhost:3000/api');
});

test('redactSecretsInText scrubs the tokenized URL from a git push command-failed error', () => {
  const raw = "Command failed: git push https://x-access-token:ghp_abcdEFGH1234567890wxyz@github.com/owner/repo.git main:refs/heads/p\nremote: error";
  const out = redactSecretsInText(raw);
  assert.ok(!out.includes('ghp_abcdEFGH1234567890wxyz'), 'token must be redacted');
  assert.ok(!out.includes('x-access-token:'), 'url credentials must be redacted');
  assert.ok(out.includes('https://[redacted]@github.com/owner/repo.git'), 'host/path kept for debugging');
});
