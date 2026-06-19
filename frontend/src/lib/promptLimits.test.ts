import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PROMPT_TO_OUTLINE_CHARS,
  PROMPT_TO_OUTLINE_TEXTAREA_MAX_CHARS,
} from './promptLimits';

test('prompt-to-outline frontend limit matches backend 128K character contract', () => {
  assert.equal(MAX_PROMPT_TO_OUTLINE_CHARS, 131072);
  assert.equal(PROMPT_TO_OUTLINE_TEXTAREA_MAX_CHARS, MAX_PROMPT_TO_OUTLINE_CHARS);
});
