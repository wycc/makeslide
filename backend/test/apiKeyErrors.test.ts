import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiKeyMissingError, isApiKeyMissingError } from '../src/services/apiKeyErrors';

test('ApiKeyMissingError carries provider, code and a default message', () => {
  const err = new ApiKeyMissingError('openai');
  assert.equal(err.code, 'API_KEY_MISSING');
  assert.equal(err.provider, 'openai');
  assert.equal(err.name, 'ApiKeyMissingError');
  assert.match(err.message, /openai/);
  assert.ok(err instanceof Error);
});

test('ApiKeyMissingError keeps a custom message when given', () => {
  const err = new ApiKeyMissingError('gemini', 'custom message');
  assert.equal(err.message, 'custom message');
  assert.equal(err.provider, 'gemini');
});

test('isApiKeyMissingError recognises the error instance', () => {
  assert.equal(isApiKeyMissingError(new ApiKeyMissingError('openai')), true);
});

test('isApiKeyMissingError recognises a duck-typed object by code', () => {
  assert.equal(isApiKeyMissingError({ code: 'API_KEY_MISSING' }), true);
});

test('isApiKeyMissingError rejects unrelated values', () => {
  assert.equal(isApiKeyMissingError(new Error('nope')), false);
  assert.equal(isApiKeyMissingError({ code: 'OTHER' }), false);
  assert.equal(isApiKeyMissingError(null), false);
  assert.equal(isApiKeyMissingError(undefined), false);
  assert.equal(isApiKeyMissingError('API_KEY_MISSING'), false);
  assert.equal(isApiKeyMissingError({}), false);
});
