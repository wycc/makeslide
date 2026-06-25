import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeErrorCode, apiError, ERROR_CODE } from '../src/errors';

// normalizeErrorCode is now wired into errorResponse (routes/pdfs.ts and
// routes/pdfs/shared.ts), so every legacy->standard mapping below is what the
// API actually emits to clients. These assertions guard that contract.
const LEGACY_MAPPINGS: Array<[string, string]> = [
  ['NO_FILE', 'FILE_REQUIRED'],
  ['INVALID_MIME', 'INVALID_UPLOAD_TYPE'],
  ['INVALID_YOUTUBE_URL', 'INVALID_URL'],
  ['JOB_ALREADY_RUNNING', 'JOB_CONFLICT'],
  ['JOB_NOT_ACTIVE', 'JOB_CONFLICT'],
  ['COVER_NOT_READY', 'RESOURCE_NOT_FOUND'],
  ['VIDEO_NOT_FOUND', 'RESOURCE_NOT_FOUND'],
  ['OUTLINE_NOT_FOUND', 'RESOURCE_NOT_FOUND'],
  ['PAGE_IMAGE_NOT_FOUND', 'RESOURCE_NOT_FOUND'],
  ['PAGE_TEXT_NOT_FOUND', 'RESOURCE_NOT_FOUND'],
  ['PAGE_SCRIPT_NOT_FOUND', 'RESOURCE_NOT_FOUND'],
  ['PAGE_AUDIO_NOT_FOUND', 'RESOURCE_NOT_FOUND'],
];

test('normalizeErrorCode maps every legacy code to its standard code', () => {
  for (const [legacy, standard] of LEGACY_MAPPINGS) {
    assert.equal(normalizeErrorCode(legacy), standard, `${legacy} -> ${standard}`);
  }
});

test('normalizeErrorCode passes standard codes through unchanged', () => {
  for (const code of Object.values(ERROR_CODE)) {
    assert.equal(normalizeErrorCode(code), code);
  }
});

test('normalizeErrorCode passes unknown codes through unchanged', () => {
  assert.equal(normalizeErrorCode('SOMETHING_ELSE'), 'SOMETHING_ELSE');
  assert.equal(normalizeErrorCode('FORBIDDEN'), 'FORBIDDEN');
  assert.equal(normalizeErrorCode(''), '');
});

test('apiError normalizes the code and carries the message', () => {
  assert.deepEqual(apiError('PAGE_IMAGE_NOT_FOUND', 'missing'), {
    error: { code: 'RESOURCE_NOT_FOUND', message: 'missing' },
  });
  assert.deepEqual(apiError('INVALID_REQUEST', 'bad'), {
    error: { code: 'INVALID_REQUEST', message: 'bad' },
  });
});

test('apiError includes a detail field only when provided', () => {
  const withDetail = apiError('INVALID_MIME', 'nope', { field: 'file' });
  assert.deepEqual(withDetail, {
    error: { code: 'INVALID_UPLOAD_TYPE', message: 'nope' },
    detail: { field: 'file' },
  });
  const withoutDetail = apiError('INVALID_MIME', 'nope');
  assert.equal('detail' in withoutDetail, false);
});
