import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitiseUserPrompt, MAX_USER_PROMPT_CHARS_IN_SYSTEM } from '../src/worker/steps/promptSanitize';

test('sanitiseUserPrompt returns empty string for nullish/blank input', () => {
  assert.equal(sanitiseUserPrompt(undefined), '');
  assert.equal(sanitiseUserPrompt(null), '');
  assert.equal(sanitiseUserPrompt(''), '');
  assert.equal(sanitiseUserPrompt('   \n  '), '');
});

test('sanitiseUserPrompt trims surrounding whitespace', () => {
  assert.equal(sanitiseUserPrompt('  hello  '), 'hello');
});

test('sanitiseUserPrompt leaves prompts at or under the cap unchanged', () => {
  const atCap = 'a'.repeat(MAX_USER_PROMPT_CHARS_IN_SYSTEM);
  assert.equal(sanitiseUserPrompt(atCap), atCap);
});

test('sanitiseUserPrompt truncates over-long prompts with the truncation marker', () => {
  const tooLong = 'b'.repeat(MAX_USER_PROMPT_CHARS_IN_SYSTEM + 50);
  const out = sanitiseUserPrompt(tooLong);
  assert.equal(out, 'b'.repeat(MAX_USER_PROMPT_CHARS_IN_SYSTEM) + '……（已截斷）');
  assert.ok(out.startsWith('b'.repeat(MAX_USER_PROMPT_CHARS_IN_SYSTEM)));
});
