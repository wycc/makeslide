import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTtsResponseForLog, synthesizeGeminiSpeech } from '../src/services/gemini';

function mockFetchOnce(jsonBody: unknown, status = 200): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(jsonBody), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

// ── summarizeTtsResponseForLog ──────────────────────────────────────────

test('summarizeTtsResponseForLog reports a fully valid inlineData shape', () => {
  const json = {
    candidates: [
      {
        finishReason: 'STOP',
        content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: 'aGVsbG8=' } }] },
      },
    ],
  };
  const summary = summarizeTtsResponseForLog(json);
  assert.equal(summary.hasCandidates, true);
  assert.equal(summary.candidatesCount, 1);
  assert.equal(summary.hasContent, true);
  assert.equal(summary.hasParts, true);
  assert.equal(summary.partsCount, 1);
  assert.deepEqual(summary.partKinds, ['inlineData']);
  assert.equal(summary.finishReason, 'STOP');
});

test('summarizeTtsResponseForLog reports an empty candidates array', () => {
  const summary = summarizeTtsResponseForLog({ candidates: [] });
  assert.equal(summary.hasCandidates, true);
  assert.equal(summary.candidatesCount, 0);
  assert.equal(summary.hasContent, false);
  assert.equal(summary.hasParts, false);
});

test('summarizeTtsResponseForLog reports a candidate whose parts contain only text (no inlineData)', () => {
  const json = {
    candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'blocked' }] } }],
  };
  const summary = summarizeTtsResponseForLog(json);
  assert.equal(summary.hasParts, true);
  assert.deepEqual(summary.partKinds, ['text']);
  assert.equal(summary.finishReason, 'SAFETY');
});

test('summarizeTtsResponseForLog handles a completely missing candidates field', () => {
  const summary = summarizeTtsResponseForLog({});
  assert.equal(summary.hasCandidates, false);
  assert.equal(summary.candidatesCount, 0);
  assert.equal(summary.hasContent, false);
  assert.equal(summary.hasParts, false);
  assert.equal(summary.finishReason, null);
});

// ── synthesizeGeminiSpeech ──────────────────────────────────────────────

test('synthesizeGeminiSpeech throws a clear error when the response has no candidates', async () => {
  const restore = mockFetchOnce({ candidates: [] });
  try {
    await assert.rejects(
      () => synthesizeGeminiSpeech({ model: 'gemini-test-tts', text: 'hello' }),
      /Gemini TTS returned empty audio/,
    );
  } finally {
    restore();
  }
});

test('synthesizeGeminiSpeech throws a clear error when parts contain no inlineData', async () => {
  const restore = mockFetchOnce({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'no audio here' }] } }],
  });
  try {
    await assert.rejects(
      () => synthesizeGeminiSpeech({ model: 'gemini-test-tts', text: 'hello' }),
      /Gemini TTS returned empty audio/,
    );
  } finally {
    restore();
  }
});

test('synthesizeGeminiSpeech returns raw bytes for a valid non-PCM inlineData response', async () => {
  const b64 = Buffer.from('fake-mp3-bytes').toString('base64');
  const restore = mockFetchOnce({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/mpeg', data: b64 } }] } }],
  });
  try {
    const buf = await synthesizeGeminiSpeech({ model: 'gemini-test-tts', text: 'hello' });
    assert.equal(buf.toString('utf8'), 'fake-mp3-bytes');
  } finally {
    restore();
  }
});
