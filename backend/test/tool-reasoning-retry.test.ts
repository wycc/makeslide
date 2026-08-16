import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionsReasoningEffort } from '../src/services/openai';

/**
 * Some models refuse function tools while reasoning is on. Recognising that refusal is what makes
 * the difference between the tutor looking things up and the tutor quietly answering from memory:
 * before this, every tool call fell back to a no-tools generation, and the only trace was one warn
 * line — the product looked like it simply had no tools.
 */

test('the refusal that gpt-5.6 sends is recognised', () => {
  const real = new Error(
    "400 Function tools with reasoning_effort are not supported for gpt-5.6 in /v1/chat/completions. "
    + "To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
  );
  assert.equal(mentionsReasoningEffort(real), true);
});

test('unrelated provider errors are not mistaken for it', () => {
  // Retrying these with reasoning off would waste a call and hide the real error.
  for (const message of [
    '429 Rate limit reached',
    '400 Invalid schema for response_format',
    '500 Internal server error',
    'tools are not supported by this model',
    'reasoning_effort must be one of low, medium, high',
  ]) {
    assert.equal(mentionsReasoningEffort(new Error(message)), false, message);
  }
});

test('it reads non-Error rejections too, since providers throw all sorts', () => {
  assert.equal(
    mentionsReasoningEffort('Function tools with reasoning_effort are not supported'),
    true,
  );
  assert.equal(mentionsReasoningEffort(null), false);
});
