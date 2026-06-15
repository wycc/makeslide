import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, fetchPdfSlowArtifacts } from './api';
import type { SlowArtifactsResponse } from '../types';

type MockResp = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

test('fetchPdfSlowArtifacts should call /slow-artifacts and return the parsed response', async () => {
  const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
  const responseBody: SlowArtifactsResponse = {
    artifacts: [
      {
        page_number: 5,
        artifact: 'audio',
        status: 'succeeded',
        duration_ms: 75_000,
        sla_target_ms: 60_000,
        sla_status: 'breached',
        updated_at: '2026-06-16T00:00:00.000Z',
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
    const result = await fetchPdfSlowArtifacts('deck-1');
    assert.deepEqual(result, responseBody);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, 'api/pdfs/deck-1/slow-artifacts');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('fetchPdfSlowArtifacts should pass limit and share token as query params', async () => {
  const calls: Array<{ input: unknown }> = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (input: unknown): Promise<MockResp> => {
    calls.push({ input });
    return {
      ok: true,
      status: 200,
      json: async () => ({ artifacts: [] }),
    };
  }) as unknown) as typeof fetch;

  try {
    await fetchPdfSlowArtifacts('deck-1', 'share-token', 5);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, 'api/pdfs/deck-1/slow-artifacts?share=share-token&limit=5');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('fetchPdfSlowArtifacts should throw ApiError on error response', async () => {
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
      () => fetchPdfSlowArtifacts('missing'),
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
