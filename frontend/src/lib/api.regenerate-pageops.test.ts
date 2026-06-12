import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, generateCustomScriptCode, moveSlide, rollbackRegenerate, startRegenerateJob } from './api';

type MockResp = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

/** Builds an SSE-formatted (`event: x\ndata: {...}\n\n`) byte stream for mocking `fetch` responses. */
function sseStream(events: Array<{ event: string; data: unknown }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const { event, data } of events) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      controller.close();
    },
  });
}

test('moveSlide should call pages/move endpoint and send expected payload', async () => {
  const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (input: unknown, init?: RequestInit): Promise<MockResp> => {
    calls.push({ input, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'deck-1', page_count: 5, updated_at: 'now' }),
    };
  }) as unknown) as typeof fetch;

  try {
    const result = await moveSlide('deck-1', 2, 4);
    assert.equal(result.id, 'deck-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, 'api/pdfs/deck-1/pages/move');
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.equal(calls[0]?.init?.body, JSON.stringify({ from_page_number: 2, to_page_number: 4 }));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('startRegenerateJob should throw ApiError on conflict response', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (): Promise<MockResp> => {
    return {
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'JOB_ALREADY_RUNNING', message: '已有重生任務正在執行' } }),
    };
  }) as unknown) as typeof fetch;

  try {
    await assert.rejects(
      () => startRegenerateJob('deck-2', { scripts: { prompt: 'x' } }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal((err as ApiError).code, 'JOB_ALREADY_RUNNING');
        return true;
      },
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('rollbackRegenerate should throw ApiError on snapshot-not-found', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (): Promise<MockResp> => {
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'SNAPSHOT_NOT_FOUND', message: '找不到可還原的快照' } }),
    };
  }) as unknown) as typeof fetch;

  try {
    await assert.rejects(
      () => rollbackRegenerate('deck-3'),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal((err as ApiError).code, 'SNAPSHOT_NOT_FOUND');
        return true;
      },
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('generateCustomScriptCode should call root API route from nested play pages and report streamed deltas', async () => {
  const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
  const prevFetch = globalThis.fetch;
  const finalCode = 'window.renderAnimation = function (root, api) { api.onFrame(function () {}); };';
  globalThis.fetch = ((async (input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    return new Response(
      sseStream([
        { event: 'delta', data: { text: finalCode.slice(0, 10) } },
        { event: 'delta', data: { text: finalCode.slice(10) } },
        { event: 'done', data: { code: finalCode } },
      ]),
      { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    );
  }) as unknown) as typeof fetch;

  try {
    const deltas: string[] = [];
    const result = await generateCustomScriptCode(
      'deck/with slash',
      3,
      { prompt: '畫資料點動畫', previousCode: 'old code' },
      (delta) => deltas.push(delta),
    );
    assert.match(result.code, /renderAnimation/);
    assert.equal(deltas.join(''), finalCode);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, '/api/pdfs/deck%2Fwith%20slash/pages/3/animation/custom-script');
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.equal(calls[0]?.init?.body, JSON.stringify({ prompt: '畫資料點動畫', previousCode: 'old code' }));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('generateCustomScriptCode should throw ApiError when the stream sends an error event', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (): Promise<Response> => {
    return new Response(
      sseStream([{ event: 'error', data: { code: 'UNSAFE_SCRIPT', message: '產生的程式碼使用了不允許的 API' } }]),
      { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    );
  }) as unknown) as typeof fetch;

  try {
    await assert.rejects(
      () => generateCustomScriptCode('deck-4', 1, { prompt: '畫圖' }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal((err as ApiError).code, 'UNSAFE_SCRIPT');
        return true;
      },
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});
