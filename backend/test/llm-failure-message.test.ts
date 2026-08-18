import test from 'node:test';
import assert from 'node:assert/strict';
import { APIError } from 'openai';
import { describeLlmFailure } from '../src/services/llmFailureMessage';
import { ApiKeyMissingError } from '../src/services/apiKeyErrors';

// The custom-script animation endpoint used to answer every LLM failure with a dead-end generic
// "Failed to generate custom-script animation code". In the incident that motivated this, the
// account had switched to CGU Air whose gateway credit ran out: every call failed with 429
// `credit_balance_exhausted`, and because the raw gateway error embeds OpenAI's billing URL, the
// user concluded the app was still calling OpenAI. describeLlmFailure classifies the common,
// actionable failures into fixed zh-TW strings (never echoing the raw provider message, which can
// embed the API key prefix or upstream URLs) and returns null for anything unrecognised.

function apiError(status: number, body: Record<string, unknown>): APIError {
  return new APIError(status, body, undefined, undefined as never);
}

test('maps the CGU gateway credit-exhausted 429 to a quota message, without the upstream billing URL', () => {
  // Mirrors the gateway's real response body for an exhausted account.
  const msg = describeLlmFailure(
    apiError(429, {
      code: 'credit_balance_exhausted',
      type: 'insufficient_quota',
      message: 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
    }),
  );
  assert.match(String(msg), /額度已用盡/);
  assert.doesNotMatch(String(msg), /platform\.openai\.com/);
});

test("maps OpenAI's own billing-cap 429 to the quota message, not the rate-limit one", () => {
  const msg = describeLlmFailure(
    apiError(429, { code: 'insufficient_quota', type: 'insufficient_quota', message: 'You exceeded your current quota' }),
  );
  assert.match(String(msg), /額度已用盡/);
});

test('maps a plain 429 rate limit to a retry-later message', () => {
  const msg = describeLlmFailure(
    apiError(429, { code: 'rate_limit_exceeded', type: 'requests', message: 'Rate limit reached, retry after 2s' }),
  );
  assert.match(String(msg), /rate limit/);
});

test('maps a 401 to a key message and never echoes the raw key from the provider body', () => {
  const msg = describeLlmFailure(
    apiError(401, { code: 'invalid_api_key', type: 'invalid_request_error', message: 'Incorrect API key provided: sk-secret123' }),
  );
  assert.match(String(msg), /金鑰無效/);
  assert.doesNotMatch(String(msg), /sk-secret123/);
});

test('maps a missing key (ApiKeyMissingError) to a set-the-key message', () => {
  const msg = describeLlmFailure(new ApiKeyMissingError('CGU Air', 'CGU_AIR_API_KEY is not set'));
  assert.match(String(msg), /金鑰未設定/);
});

test('maps an unknown-model 404 to a check-the-model message', () => {
  const msg = describeLlmFailure(
    apiError(404, { code: 'model_not_found', type: 'invalid_request_error', message: 'The model `gpt-99` does not exist' }),
  );
  assert.match(String(msg), /模型不存在/);
});

test('maps a request timeout to a timeout message', () => {
  const msg = describeLlmFailure(new Error('Request timed out.'));
  assert.match(String(msg), /逾時/);
});

test('maps a connection failure to a connectivity message', () => {
  const msg = describeLlmFailure(new Error('Connection error: fetch failed'));
  assert.match(String(msg), /無法連線/);
});

test('returns null for an unrecognised error so the caller keeps its generic message', () => {
  assert.equal(describeLlmFailure(new Error('boom something unexpected')), null);
  assert.equal(describeLlmFailure(undefined), null);
});
