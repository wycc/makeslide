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

test('generateCustomScriptCode should call root API route from nested play pages and report streamed plan and code deltas', async () => {
  const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
  const prevFetch = globalThis.fetch;
  const finalPlan = '1. 建立一個藍色圓形\n2. 隨動畫進度放大圓形';
  const finalCode = 'window.renderAnimation = function (root, api) { api.onFrame(function () {}); };';
  globalThis.fetch = ((async (input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    return new Response(
      sseStream([
        { event: 'plan-delta', data: { text: finalPlan.slice(0, 10) } },
        { event: 'plan-delta', data: { text: finalPlan.slice(10) } },
        { event: 'plan-done', data: { plan: finalPlan } },
        { event: 'delta', data: { text: finalCode.slice(0, 10) } },
        { event: 'delta', data: { text: finalCode.slice(10) } },
        { event: 'done', data: { code: finalCode } },
      ]),
      { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    );
  }) as unknown) as typeof fetch;

  try {
    const planDeltas: string[] = [];
    const codeDeltas: string[] = [];
    const planDones: string[] = [];
    const result = await generateCustomScriptCode(
      'deck/with slash',
      3,
      { prompt: '畫資料點動畫', previousCode: 'old code' },
      {
        onPlanDelta: (delta) => planDeltas.push(delta),
        onPlanDone: (plan) => planDones.push(plan),
        onDelta: (delta) => codeDeltas.push(delta),
      },
    );
    assert.match(result.code, /renderAnimation/);
    assert.equal(result.plan, finalPlan);
    assert.equal(planDeltas.join(''), finalPlan);
    assert.deepEqual(planDones, [finalPlan]);
    assert.equal(codeDeltas.join(''), finalCode);
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

test('generateCustomScriptCode reports a patch through its own callbacks, never as code deltas', async () => {
  // Editing existing code streams search/replace fragments, not code. Routing those to onDelta
  // would paint half a patch into the source editor as if the script had been mangled.
  const prevFetch = globalThis.fetch;
  const patchText = '<<<<<<< SEARCH\nvar c = "red";\n=======\nvar c = "blue";\n>>>>>>> REPLACE';
  const finalCode = 'window.renderAnimation = function (root, api) { var c = "blue"; api.onFrame(function () {}); };';
  globalThis.fetch = ((async (): Promise<Response> => new Response(
    sseStream([
      { event: 'plan-done', data: { plan: '1. 改成藍色' } },
      { event: 'patch-delta', data: { text: patchText.slice(0, 20) } },
      { event: 'patch-delta', data: { text: patchText.slice(20) } },
      { event: 'patch-done', data: { applied: 1 } },
      { event: 'done', data: { code: finalCode } },
    ]),
    { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  )) as unknown) as typeof fetch;

  try {
    const patchDeltas: string[] = [];
    const codeDeltas: string[] = [];
    const applied: number[] = [];
    const result = await generateCustomScriptCode(
      'deck',
      1,
      { prompt: '改成藍色', previousCode: 'var c = "red";' },
      {
        onPatchDelta: (delta) => patchDeltas.push(delta),
        onPatchDone: (count) => applied.push(count),
        onDelta: (delta) => codeDeltas.push(delta),
      },
    );
    assert.equal(patchDeltas.join(''), patchText);
    assert.deepEqual(applied, [1]);
    assert.deepEqual(codeDeltas, [], 'a patch must not arrive as code deltas');
    assert.equal(result.code, finalCode);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('generateCustomScriptCode surfaces a patch fallback before the full code arrives', async () => {
  const prevFetch = globalThis.fetch;
  const finalCode = 'window.renderAnimation = function (root, api) { api.onFrame(function () {}); };';
  globalThis.fetch = ((async (): Promise<Response> => new Response(
    sseStream([
      { event: 'patch-delta', data: { text: '<<<<<<< SEARCH\nstale\n' } },
      { event: 'patch-fallback', data: { reason: "block 1's SEARCH text is not present in the current code" } },
      { event: 'delta', data: { text: finalCode } },
      { event: 'done', data: { code: finalCode } },
    ]),
    { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  )) as unknown) as typeof fetch;

  try {
    const events: string[] = [];
    const result = await generateCustomScriptCode(
      'deck',
      1,
      { prompt: '改一下', previousCode: 'current code' },
      {
        onPatchDelta: () => events.push('patch-delta'),
        onPatchFallback: (reason) => events.push(`fallback:${reason.slice(0, 5)}`),
        onDelta: () => events.push('delta'),
      },
    );
    // The order matters: the fallback has to be announced before the full rewrite streams in, or it
    // looks like a small edit regenerated everything for no reason.
    assert.deepEqual(events, ['patch-delta', 'fallback:block', 'delta']);
    assert.equal(result.code, finalCode);
  } finally {
    globalThis.fetch = prevFetch;
  }
});
