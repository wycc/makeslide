import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config';
import { callGeminiJson, synthesizeGeminiSpeech } from '../src/services/gemini';
import { z } from 'zod';

function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const original = config.openaiRequestTimeoutMs;
  config.openaiRequestTimeoutMs = ms;
  return fn().finally(() => {
    config.openaiRequestTimeoutMs = original;
  });
}

test('callGeminiJson passes an AbortSignal derived from the configured request timeout', async () => {
  const originalFetch = globalThis.fetch;
  let capturedSignal: AbortSignal | undefined;
  globalThis.fetch = (async (_url, init) => {
    capturedSignal = (init as RequestInit)?.signal as AbortSignal | undefined;
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    await callGeminiJson({
      model: 'gemini-test',
      messages: [{ role: 'user', content: 'hi' }],
      schema: z.object({ ok: z.boolean() }),
    });
    assert.ok(capturedSignal instanceof AbortSignal, 'expected a fetch signal to be passed');
    assert.equal(capturedSignal!.aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callGeminiJson rejects instead of hanging forever when the request exceeds the configured timeout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_url, init) => {
    const signal = (init as RequestInit)?.signal as AbortSignal | undefined;
    return new Promise((_resolve, reject) => {
      // Never resolves on its own — mirrors a Gemini API connection that hangs.
      signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
  }) as typeof fetch;
  try {
    await withTimeout(20, () =>
      assert.rejects(
        () =>
          callGeminiJson({
            model: 'gemini-test',
            messages: [{ role: 'user', content: 'hi' }],
            schema: z.object({ ok: z.boolean() }),
          }),
        (err: unknown) => err instanceof Error && err.name === 'AbortError',
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('synthesizeGeminiSpeech rejects instead of hanging forever when the request exceeds the configured timeout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_url, init) => {
    const signal = (init as RequestInit)?.signal as AbortSignal | undefined;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
  }) as typeof fetch;
  try {
    await withTimeout(20, () =>
      assert.rejects(
        () => synthesizeGeminiSpeech({ model: 'gemini-test-tts', text: 'hello' }),
        (err: unknown) => err instanceof Error && err.name === 'AbortError',
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
