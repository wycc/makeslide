import test from 'node:test';
import assert from 'node:assert/strict';
import { APIError } from 'openai';
import { describeImageEditFailure } from '../src/routes/pdfs/page-operations';

// The per-page image-edit endpoints (regenerate-image / inpaint-image) used to answer every
// provider failure with a dead-end generic "Failed to inpaint image" / "Failed to regenerate
// image". describeImageEditFailure maps the common, actionable provider failures to a concise
// zh-TW reason the interactive UI can show verbatim, and returns null (keep the generic message)
// for anything it can't classify. It must never echo the raw provider message, which can embed the
// API key prefix (OpenAI's 401 body) or internal base URLs.

function apiError(status: number, body: Record<string, unknown>): APIError {
  return new APIError(status, body, undefined, undefined as never);
}

test('maps a gateway quota-exhausted 403 to an actionable quota message', () => {
  // Mirrors the CGU gateway's real response for an exhausted account.
  const msg = describeImageEditFailure(
    apiError(403, { code: 'insufficient_openai_quota', type: 'insufficient_quota', message: 'OpenAI cost quota exceeded' }),
  );
  assert.match(String(msg), /額度已用盡/);
});

test('maps an OpenAI billing-cap error (surfaced under 429) to the quota message', () => {
  const msg = describeImageEditFailure(
    apiError(429, { code: 'insufficient_quota', type: 'insufficient_quota', message: 'You exceeded your current quota' }),
  );
  assert.match(String(msg), /額度已用盡/);
});

test('maps a 401 to a key message and never echoes the raw key from the provider body', () => {
  const msg = describeImageEditFailure(
    apiError(401, { code: 'invalid_api_key', type: 'invalid_request_error', message: 'Incorrect API key provided: sk-secret123' }),
  );
  assert.match(String(msg), /金鑰無效/);
  assert.doesNotMatch(String(msg), /sk-secret123/);
});

test('maps a non-quota 403 to an access-denied message', () => {
  const msg = describeImageEditFailure(apiError(403, { code: 'forbidden', type: 'forbidden', message: 'Forbidden' }));
  assert.match(String(msg), /拒絕存取/);
});

test('maps a request timeout to a timeout message', () => {
  const msg = describeImageEditFailure(new Error('Request timed out.'));
  assert.match(String(msg), /逾時/);
});

test('maps the empty-result guard to a no-result message', () => {
  const msg = describeImageEditFailure(new Error('OpenAI image edit returned empty result'));
  assert.match(String(msg), /未回傳結果/);
});

test('returns null for an unrecognised error so the caller keeps its generic message', () => {
  assert.equal(describeImageEditFailure(new Error('boom something unexpected')), null);
  assert.equal(describeImageEditFailure(undefined), null);
});
