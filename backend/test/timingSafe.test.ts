import test from 'node:test';
import assert from 'node:assert/strict';

import { timingSafeStringEqual } from '../src/timingSafe';

test('timingSafeStringEqual returns true only for an exact match', () => {
  assert.equal(timingSafeStringEqual('abc123', 'abc123'), true);
  assert.equal(timingSafeStringEqual('abc123', 'abc124'), false);
});

test('timingSafeStringEqual returns false for different lengths without throwing', () => {
  assert.equal(timingSafeStringEqual('short', 'longer-secret'), false);
  assert.equal(timingSafeStringEqual('', 'x'), false);
});

test('timingSafeStringEqual treats two empty strings as equal', () => {
  assert.equal(timingSafeStringEqual('', ''), true);
});

test('timingSafeStringEqual compares by utf-8 bytes (handles multibyte content)', () => {
  assert.equal(timingSafeStringEqual('héllo', 'héllo'), true);
  assert.equal(timingSafeStringEqual('héllo', 'hello'), false);
});
