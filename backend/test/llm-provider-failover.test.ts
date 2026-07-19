import test from 'node:test';
import assert from 'node:assert/strict';
import { APIError } from 'openai';
import { isPermanentProviderError } from '../src/services/openai';
import { ApiKeyMissingError } from '../src/services/apiKeyErrors';

test('isPermanentProviderError treats 401/403 APIError as permanent', () => {
  assert.equal(isPermanentProviderError(new APIError(401, { code: 'invalid_api_key' }, 'Incorrect API key', undefined)), true);
  assert.equal(isPermanentProviderError(new APIError(403, { code: 'account_deactivated' }, 'Account deactivated', undefined)), true);
});

test('isPermanentProviderError treats 429 with a quota/billing code or type as permanent', () => {
  assert.equal(isPermanentProviderError(new APIError(429, { code: 'insufficient_quota' }, 'You exceeded your quota', undefined)), true);
  assert.equal(isPermanentProviderError(new APIError(429, { type: 'insufficient_quota' }, 'billing hard cap reached', undefined)), true);
});

test('isPermanentProviderError treats a plain 429 rate limit as transient (not permanent)', () => {
  assert.equal(isPermanentProviderError(new APIError(429, { code: 'rate_limit_exceeded' }, 'Rate limit reached', undefined)), false);
});

test('isPermanentProviderError treats a billing-hard-limit error as permanent regardless of HTTP status (real-world case: OpenAI returns this as 400, not 401/403/429)', () => {
  // APIError's constructor only uses its 3rd (`message`) arg as a fallback when the error-body
  // (2nd arg) is falsy — a real API error body is a truthy object, so the message must be set on
  // it (`.message`) to end up in `err.message`, same as OpenAI's actual response shape.
  assert.equal(
    isPermanentProviderError(new APIError(400, { message: 'Billing hard limit has been reached.' }, undefined, undefined)),
    true,
  );
  assert.equal(
    isPermanentProviderError(new APIError(402, { message: 'Payment required — billing limit exceeded' }, undefined, undefined)),
    true,
  );
});

test('isPermanentProviderError treats an unrelated 400 (e.g. bad request) as transient (not permanent)', () => {
  assert.equal(isPermanentProviderError(new APIError(400, { code: 'invalid_request_error' }, 'Missing required parameter', undefined)), false);
});

test('isPermanentProviderError treats 5xx as transient', () => {
  assert.equal(isPermanentProviderError(new APIError(500, {}, 'Internal server error', undefined)), false);
  assert.equal(isPermanentProviderError(new APIError(503, {}, 'Service unavailable', undefined)), false);
});

test('isPermanentProviderError treats ApiKeyMissingError as permanent', () => {
  assert.equal(isPermanentProviderError(new ApiKeyMissingError('OpenAI')), true);
});

test('isPermanentProviderError parses Gemini-style plain Error messages (HTTP 401/403, quota/billing text)', () => {
  assert.equal(isPermanentProviderError(new Error('Gemini request failed: HTTP 401')), true);
  assert.equal(isPermanentProviderError(new Error('Gemini request failed: HTTP 403')), true);
  assert.equal(isPermanentProviderError(new Error('403 OpenAI cost quota exceeded')), true);
  assert.equal(isPermanentProviderError(new Error('Gemini request failed: HTTP 500')), false);
});

test('isPermanentProviderError treats unrelated errors as not permanent', () => {
  assert.equal(isPermanentProviderError(new Error('ECONNRESET')), false);
  assert.equal(isPermanentProviderError('a plain string'), false);
  assert.equal(isPermanentProviderError(null), false);
});
