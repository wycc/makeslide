import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiError,
  isAlreadyProcessingConflict,
  isApiErrorBody,
  isCreditExhaustedError,
  isApiKeyMissingError,
  CREDIT_EXHAUSTED_ERROR_CODES,
} from './common';

test('isAlreadyProcessingConflict matches the 409 INVALID_STATE conflict from POST /start', () => {
  const err = new ApiError('PDF abc 已經在處理或已完成 (status=processing)，無法重新提交提示詞', 'INVALID_STATE', 409);
  assert.equal(isAlreadyProcessingConflict(err), true);
});

test('isAlreadyProcessingConflict rejects INVALID_STATE errors with a different status code', () => {
  const err = new ApiError('Regenerate job is already running', 'INVALID_STATE', 400);
  assert.equal(isAlreadyProcessingConflict(err), false);
});

test('isAlreadyProcessingConflict rejects 409 errors with a different error code', () => {
  const err = new ApiError('Regenerate job is already running', 'JOB_CONFLICT', 409);
  assert.equal(isAlreadyProcessingConflict(err), false);
});

test('isAlreadyProcessingConflict returns false for non-ApiError values', () => {
  assert.equal(isAlreadyProcessingConflict(new Error('boom')), false);
  assert.equal(isAlreadyProcessingConflict('boom'), false);
  assert.equal(isAlreadyProcessingConflict(null), false);
  assert.equal(isAlreadyProcessingConflict(undefined), false);
});

test('isApiErrorBody accepts a well-formed { error: { code, message } } body', () => {
  assert.equal(isApiErrorBody({ error: { code: 'INVALID_REQUEST', message: 'bad' } }), true);
});

test('isApiErrorBody rejects malformed bodies', () => {
  assert.equal(isApiErrorBody(null), false);
  assert.equal(isApiErrorBody('nope'), false);
  assert.equal(isApiErrorBody({}), false);
  assert.equal(isApiErrorBody({ error: null }), false);
  assert.equal(isApiErrorBody({ error: { code: 'X' } }), false); // missing message
  assert.equal(isApiErrorBody({ error: { code: 1, message: 'Y' } }), false); // non-string code
});

test('isCreditExhaustedError is true for every credit-exhausted code and false otherwise', () => {
  for (const code of CREDIT_EXHAUSTED_ERROR_CODES) {
    assert.equal(isCreditExhaustedError(new ApiError('x', code, 402)), true, code);
  }
  assert.equal(isCreditExhaustedError(new ApiError('x', 'INVALID_REQUEST', 400)), false);
  assert.equal(isCreditExhaustedError(new Error('boom')), false);
  assert.equal(isCreditExhaustedError(null), false);
});

test('isApiKeyMissingError matches only the API_KEY_MISSING ApiError', () => {
  assert.equal(isApiKeyMissingError(new ApiError('x', 'API_KEY_MISSING', 400)), true);
  assert.equal(isApiKeyMissingError(new ApiError('x', 'MODEL_QUOTA_EXCEEDED', 402)), false);
  assert.equal(isApiKeyMissingError(new Error('boom')), false);
  assert.equal(isApiKeyMissingError(undefined), false);
});
