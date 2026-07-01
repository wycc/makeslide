import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeQuizRecordingSegment, quizRecordingFilename } from '../src/services/quizRecording';

test('sanitizeQuizRecordingSegment strips path separators and unsafe characters', () => {
  assert.equal(sanitizeQuizRecordingSegment('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(sanitizeQuizRecordingSegment('a/b\\c'), 'a_b_c');
  assert.equal(sanitizeQuizRecordingSegment('safe-ID_1.2'), 'safe-ID_1.2');
});

test('sanitizeQuizRecordingSegment falls back to a placeholder for empty results', () => {
  assert.equal(sanitizeQuizRecordingSegment(''), 'x');
});

test('sanitizeQuizRecordingSegment caps length', () => {
  assert.equal(sanitizeQuizRecordingSegment('a'.repeat(200), 10).length, 10);
});

test('quizRecordingFilename composes a safe .webm name', () => {
  assert.equal(quizRecordingFilename(7, 'sess-1', 'client-2'), '7_sess-1_client-2.webm');
  assert.equal(quizRecordingFilename(7, '../x', 'y/z'), '7_.._x_y_z.webm');
});
