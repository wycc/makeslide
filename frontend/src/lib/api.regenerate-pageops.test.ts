import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, moveSlide, rollbackRegenerate, startRegenerateJob } from './api';

type MockResp = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

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
