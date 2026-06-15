import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, fetchPdfRunHistory } from './api';
import type { PipelineRunsResponse } from '../types';

type MockResp = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

test('fetchPdfRunHistory should call /runs and return the parsed response', async () => {
  const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
  const responseBody: PipelineRunsResponse = {
    runs: [
      {
        id: 'run_1',
        run_type: 'initial',
        parent_run_id: null,
        triggered_by: 'user',
        status: 'succeeded',
        attempt: 1,
        started_at: '2026-06-16T00:00:00.000Z',
        ended_at: '2026-06-16T00:01:00.000Z',
        duration_ms: 60_000,
        sla_status: 'met',
        error_code: null,
        error_message: null,
        metadata: null,
        stages: [],
        llm_usage: {
          requests: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          total_latency_ms: 0,
          estimated_cost_usd: null,
        },
      },
    ],
  };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (input: unknown, init?: RequestInit): Promise<MockResp> => {
    calls.push({ input, init });
    return {
      ok: true,
      status: 200,
      json: async () => responseBody,
    };
  }) as unknown) as typeof fetch;

  try {
    const result = await fetchPdfRunHistory('deck-1');
    assert.deepEqual(result, responseBody);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, 'api/pdfs/deck-1/runs');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('fetchPdfRunHistory should pass limit and share token as query params', async () => {
  const calls: Array<{ input: unknown }> = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (input: unknown): Promise<MockResp> => {
    calls.push({ input });
    return {
      ok: true,
      status: 200,
      json: async () => ({ runs: [] }),
    };
  }) as unknown) as typeof fetch;

  try {
    await fetchPdfRunHistory('deck-1', 'share-token', 5);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, 'api/pdfs/deck-1/runs?share=share-token&limit=5');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('fetchPdfRunHistory should throw ApiError on error response', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (): Promise<MockResp> => {
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'PDF_NOT_FOUND', message: 'PDF not found' } }),
    };
  }) as unknown) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchPdfRunHistory('missing'),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal((err as ApiError).code, 'PDF_NOT_FOUND');
        return true;
      },
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});
