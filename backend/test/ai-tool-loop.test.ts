import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { setOpenAIClientForTest, callChatJSON, streamChatText } from '../src/services/openai';
import type { AiTool, AiToolContext } from '../src/services/aiTools';

// A tiny read-only fake tool so we can assert the loop executes it and feeds the
// result back, without touching the DB.
const fakeTools: AiTool[] = [
  {
    name: 'get_secret',
    description: 'returns a secret marker',
    parameters: { type: 'object', properties: {}, required: [] },
    async handler() { return 'SECRET_42'; },
  },
];
const ctx: AiToolContext = { accountId: 'acct-x' };

test('callChatJSON runs a tool round then produces final JSON with the tool result fed back', async () => {
  const calls: Array<{ messages: Array<{ role: string; content: unknown }>; hasTools: boolean }> = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Array<{ role: string; content: unknown }>; tools?: unknown }) => {
          calls.push({ messages: args.messages, hasTools: Array.isArray(args.tools) });
          if (calls.length === 1) {
            // First round: ask to call the tool.
            return {
              choices: [{
                message: { content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'get_secret', arguments: '{}' } }] },
                finish_reason: 'tool_calls',
              }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          }
          // Second round: final JSON answer.
          return {
            choices: [{ message: { content: JSON.stringify({ answer: 'done' }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
          };
        },
      },
    },
  } as never);

  try {
    const result = await callChatJSON({
      messages: [{ role: 'user', content: 'hi' }],
      schema: z.object({ answer: z.string() }),
      tools: fakeTools,
      toolContext: ctx,
      label: 'tool-loop-test',
    });
    assert.equal(result.data.answer, 'done');
    assert.equal(calls.length, 2, 'should take two rounds (tool call + final answer)');
    // The second request must include the tool result appended as a role:'tool' message.
    const secondFlat = JSON.stringify(calls[1]!.messages);
    assert.match(secondFlat, /SECRET_42/, 'tool result must be fed back to the model');
    assert.match(secondFlat, /"role":"tool"/);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('streamChatText runs a tool round then streams the final answer deltas', async () => {
  let round = 0;
  const captured: Array<Array<{ role: string; content: unknown }>> = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Array<{ role: string; content: unknown }> }) => {
          round += 1;
          captured.push(args.messages);
          if (round === 1) {
            return {
              async *[Symbol.asyncIterator]() {
                yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc1', function: { name: 'get_secret', arguments: '{}' } }] }, finish_reason: null }] };
                yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
              },
            };
          }
          return {
            async *[Symbol.asyncIterator]() {
              for (const seg of ['答案', '第二段']) {
                yield { choices: [{ delta: { content: seg }, finish_reason: null }] };
              }
              yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } };
            },
          };
        },
      },
    },
  } as never);

  try {
    const deltas: string[] = [];
    const result = await streamChatText({
      messages: [{ role: 'user', content: 'hi' }],
      tools: fakeTools,
      toolContext: ctx,
      onDelta: (d) => deltas.push(d),
      label: 'tool-stream-test',
    });
    assert.equal(round, 2, 'tool round then final streaming round');
    assert.equal(result.text, '答案第二段');
    assert.deepEqual(deltas, ['答案', '第二段'], 'final answer streamed token-by-token');
    // Second round must carry the tool result back to the model.
    const secondFlat = JSON.stringify(captured[1]);
    assert.match(secondFlat, /SECRET_42/);
    assert.match(secondFlat, /"role":"tool"/);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('streamChatText forwards an AbortSignal to the underlying chat.completions.create call', async () => {
  const seenOptions: Array<{ signal?: AbortSignal } | undefined> = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (
          _args: { messages: Array<{ role: string; content: unknown }> },
          options?: { signal?: AbortSignal },
        ) => {
          seenOptions.push(options);
          return {
            async *[Symbol.asyncIterator]() {
              yield { choices: [{ delta: { content: 'ok' }, finish_reason: null }] };
              yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
            },
          };
        },
      },
    },
  } as never);

  try {
    const controller = new AbortController();
    await streamChatText({
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: () => {},
      label: 'abort-signal-test',
      signal: controller.signal,
    });
    assert.equal(seenOptions.length, 1);
    assert.equal(seenOptions[0]?.signal, controller.signal, 'the caller-provided AbortSignal must reach the SDK call');
  } finally {
    setOpenAIClientForTest(null);
  }
});
