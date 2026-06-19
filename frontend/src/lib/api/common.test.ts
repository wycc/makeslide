import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, isAlreadyProcessingConflict } from './common';

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
