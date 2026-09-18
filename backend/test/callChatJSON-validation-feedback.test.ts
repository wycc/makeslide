import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { setOpenAIClientForTest, callChatJSON, withValidationFeedback } from '../src/services/openai';

// A parse/validation failure used to retry with the *same* messages, so a model that omitted a
// field once usually omitted it again. The retry must now carry the rejected output and the
// validator's complaint so the model can correct itself.

type Msg = { role: string; content: unknown };

test('callChatJSON feeds the rejected output and the zod error back on the retry', async () => {
  const calls: Msg[][] = [];
  const bad = JSON.stringify({ questions: [{ type: 'single', options: ['A', 'B'] }] });
  const good = JSON.stringify({ questions: [{ type: 'single', question: 'Q?', options: ['A', 'B'] }] });
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Msg[] }) => {
          calls.push(args.messages);
          return {
            choices: [{ message: { content: calls.length === 1 ? bad : good }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as never);
  try {
    const original = [
      { role: 'system' as const, content: 'output {"questions":[{"type","question","options"}]}' },
      { role: 'user' as const, content: 'go' },
    ];
    const result = await callChatJSON({
      label: 'feedback-test',
      messages: original,
      schema: z.object({
        questions: z.array(z.object({ type: z.string(), question: z.string(), options: z.array(z.string()) })),
      }),
    });
    assert.equal(result.data.questions[0]?.question, 'Q?');
    assert.equal(calls.length, 2);
    // First attempt: the caller's messages, untouched.
    assert.deepEqual(calls[0], original);
    // Retry: original + the rejected answer as an assistant turn + a user turn naming the problem.
    assert.equal(calls[1]!.length, original.length + 2);
    assert.deepEqual(calls[1]!.slice(0, original.length), original);
    assert.equal(calls[1]![original.length]!.role, 'assistant');
    assert.equal(calls[1]![original.length]!.content, bad);
    const complaint = calls[1]![original.length + 1]!;
    assert.equal(complaint.role, 'user');
    assert.match(String(complaint.content), /question/, 'must name the missing field');
    assert.match(String(complaint.content), /完整/, 'must ask for the complete document again');
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('withValidationFeedback bounds how much of a runaway answer is quoted back', () => {
  const huge = 'x'.repeat(50_000);
  const out = withValidationFeedback([{ role: 'user', content: 'go' }], huge, new Error('boom'));
  assert.equal(out.length, 3);
  const quoted = String(out[1]!.content);
  assert.ok(quoted.length < 9000, `quoted ${quoted.length} chars`);
  assert.match(quoted, /省略/);
  assert.match(String(out[2]!.content), /boom/);
});
