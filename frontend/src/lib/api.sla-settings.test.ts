import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, getSlaSettings, updateSlaTargetOverride } from './api';
import type { SlaSettingsResponse } from '../types';

type MockResp = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const SAMPLE_RESPONSE: SlaSettingsResponse = {
  bounds: { min_ms: 1_000, max_ms: 3_600_000 },
  stages: [
    { kind: 'stage', name: 'render_pages', default_ms: 120_000, override_ms: null, effective_ms: 120_000, updated_at: null },
  ],
  artifacts: [
    { kind: 'artifact', name: 'image', default_ms: 30_000, override_ms: 15_000, effective_ms: 15_000, updated_at: '2026-06-16T00:00:00.000Z' },
  ],
};

test('getSlaSettings should call /api/system/sla-settings and return the parsed response', async () => {
  const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (input: unknown, init?: RequestInit): Promise<MockResp> => {
    calls.push({ input, init });
    return {
      ok: true,
      status: 200,
      json: async () => SAMPLE_RESPONSE,
    };
  }) as unknown) as typeof fetch;

  try {
    const result = await getSlaSettings();
    assert.deepEqual(result, SAMPLE_RESPONSE);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, 'api/system/sla-settings');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('updateSlaTargetOverride should PUT kind/name/target_ms and return the parsed response', async () => {
  const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (input: unknown, init?: RequestInit): Promise<MockResp> => {
    calls.push({ input, init });
    return {
      ok: true,
      status: 200,
      json: async () => SAMPLE_RESPONSE,
    };
  }) as unknown) as typeof fetch;

  try {
    const result = await updateSlaTargetOverride('artifact', 'image', 15_000);
    assert.deepEqual(result, SAMPLE_RESPONSE);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, 'api/system/sla-settings');
    assert.equal(calls[0]?.init?.method, 'PUT');
    assert.equal(calls[0]?.init?.body, JSON.stringify({ kind: 'artifact', name: 'image', target_ms: 15_000 }));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('updateSlaTargetOverride should accept target_ms = null to clear an override', async () => {
  const calls: Array<{ init: RequestInit | undefined }> = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (_input: unknown, init?: RequestInit): Promise<MockResp> => {
    calls.push({ init });
    return {
      ok: true,
      status: 200,
      json: async () => SAMPLE_RESPONSE,
    };
  }) as unknown) as typeof fetch;

  try {
    await updateSlaTargetOverride('stage', 'render_pages', null);
    assert.equal(calls[0]?.init?.body, JSON.stringify({ kind: 'stage', name: 'render_pages', target_ms: null }));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('getSlaSettings should throw ApiError on error response', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = ((async (): Promise<MockResp> => {
    return {
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'ADMIN_REQUIRED', message: 'admin only' } }),
    };
  }) as unknown) as typeof fetch;

  try {
    await assert.rejects(
      () => getSlaSettings(),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal((err as ApiError).code, 'ADMIN_REQUIRED');
        return true;
      },
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});
