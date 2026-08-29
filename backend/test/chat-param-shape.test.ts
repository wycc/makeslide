import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { APIError } from 'openai';
import {
  callChatJSON,
  chatParamShape,
  learnChatParamShape,
  resetLearnedChatParamShapes,
  setOpenAIClientForTest,
} from '../src/services/openai';

/** The 400 OpenAI returns when a model is sent the parameter belonging to the other generation. */
function unsupportedParamError(param: string): APIError {
  // The SDK hands the constructor the response body's `error` object, so `param`/`code` sit at
  // its top level — which is where the real failure carried 'max_tokens'.
  return new APIError(
    400,
    {
      message: `Unsupported parameter: '${param}' is not supported with this model.`,
      type: 'invalid_request_error',
      param,
      code: 'unsupported_parameter',
    },
    undefined,
    new Headers(),
  );
}

test('the GPT-5 family and o-series take max_completion_tokens and no temperature', () => {
  resetLearnedChatParamShapes();
  // The bug: this used to match only the exact string 'gpt-5.5', so moving the account to
  // 'gpt-5.6' failed every LLM call with "Unsupported parameter: 'max_tokens'".
  for (const model of ['gpt-5', 'gpt-5.5', 'gpt-5.6', 'gpt-5-mini', 'GPT-5.6', 'openai/gpt-5.6', 'o1', 'o3-mini']) {
    assert.deepEqual(chatParamShape(model), { maxCompletionTokens: true, temperature: false }, model);
  }
});

test('older models keep max_tokens and temperature', () => {
  resetLearnedChatParamShapes();
  for (const model of ['gpt-4o-mini', 'gpt-4.1', 'openai/gpt-4o', 'oss-model', 'llama-3']) {
    assert.deepEqual(chatParamShape(model), { maxCompletionTokens: false, temperature: true }, model);
  }
});

test('a 400 naming the parameter teaches the shape, so the next family is not another outage', () => {
  resetLearnedChatParamShapes();
  const model = 'gpt-42-turbo'; // deliberately unknown to the name matching
  assert.equal(chatParamShape(model).maxCompletionTokens, false);
  assert.equal(learnChatParamShape(model, unsupportedParamError('max_tokens')), true);
  assert.equal(chatParamShape(model).maxCompletionTokens, true);
  // Learned once: the same error again teaches nothing new, so it must not loop.
  assert.equal(learnChatParamShape(model, unsupportedParamError('max_tokens')), false);
  assert.equal(learnChatParamShape(model, unsupportedParamError('temperature')), true);
  assert.equal(chatParamShape(model).temperature, false);
  resetLearnedChatParamShapes();
});

test('unrelated failures are not treated as a parameter mismatch', () => {
  resetLearnedChatParamShapes();
  assert.equal(learnChatParamShape('gpt-4o-mini', unsupportedParamError('response_format')), false);
  assert.equal(learnChatParamShape('gpt-4o-mini', new Error('socket hang up')), false);
  assert.equal(learnChatParamShape('gpt-4o-mini', new APIError(429, { message: 'rate limited' }, undefined, new Headers())), false);
  assert.deepEqual(chatParamShape('gpt-4o-mini'), { maxCompletionTokens: false, temperature: true });
});

test('callChatJSON sends max_completion_tokens to a GPT-5 model and never sends temperature', async () => {
  resetLearnedChatParamShapes();
  const sent: Array<Record<string, unknown>> = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: Record<string, unknown>) => {
          sent.push(args);
          return {
            choices: [{ message: { content: JSON.stringify({ ok: true }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as never);
  try {
    await callChatJSON({
      model: 'gpt-5.6',
      messages: [{ role: 'user', content: 'hi' }],
      schema: z.object({ ok: z.boolean() }),
    });
  } finally {
    setOpenAIClientForTest(null);
  }
  assert.equal(sent.length, 1);
  assert.ok('max_completion_tokens' in sent[0]!, 'gpt-5.6 must be sent max_completion_tokens');
  assert.ok(!('max_tokens' in sent[0]!));
  assert.ok(!('temperature' in sent[0]!), 'the GPT-5 family rejects temperature');
});

test('callChatJSON repairs a rejected parameter and retries the same request', async () => {
  resetLearnedChatParamShapes();
  const sent: Array<Record<string, unknown>> = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: Record<string, unknown>) => {
          sent.push(args);
          if ('max_tokens' in args) throw unsupportedParamError('max_tokens');
          return {
            choices: [{ message: { content: JSON.stringify({ ok: true }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as never);
  try {
    const res = await callChatJSON({
      model: 'mystery-llm-1', // unknown to the family rules, so it starts on max_tokens
      messages: [{ role: 'user', content: 'hi' }],
      schema: z.object({ ok: z.boolean() }),
    });
    assert.equal(res.data.ok, true);
  } finally {
    setOpenAIClientForTest(null);
    resetLearnedChatParamShapes();
  }
  assert.equal(sent.length, 2, 'one rejected call, then the repaired one');
  assert.ok('max_tokens' in sent[0]!);
  assert.ok('max_completion_tokens' in sent[1]!);
});
