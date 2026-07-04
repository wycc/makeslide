import test from 'node:test';
import assert from 'node:assert/strict';
import { askVerbosityInstruction } from '../src/routes/pdfs/askVerbosity';

test('askVerbosityInstruction returns a concise instruction for brief', () => {
  const s = askVerbosityInstruction('brief');
  assert.match(s, /精簡/);
  assert.match(s, /重點摘要/);
});

test('askVerbosityInstruction returns a detailed instruction for detailed', () => {
  const s = askVerbosityInstruction('detailed');
  assert.match(s, /詳細|詳盡/);
  assert.match(s, /重點摘要/);
});

test('askVerbosityInstruction treats undefined as detailed (preserves default behaviour)', () => {
  assert.equal(askVerbosityInstruction(undefined), askVerbosityInstruction('detailed'));
});

test('askVerbosityInstruction always includes the summary-first guidance', () => {
  for (const v of ['brief', 'detailed', undefined] as const) {
    assert.match(askVerbosityInstruction(v), /結論先行/);
  }
});
