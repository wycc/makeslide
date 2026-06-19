import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

setSystemAuthSettings({ googleAuthEnabled: false });

const ACCOUNT_SUB = 'admin-openai-key-test-01';
const SESSION_COOKIE = testSessionCookie(ACCOUNT_SUB);
const HEADERS_JSON = { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}`, 'content-type': 'application/json' };
const ACCOUNT_DIR = path.join(config.repoRoot, 'accounts', ACCOUNT_SUB);

function cleanupAccountDir(): void {
  fs.rmSync(ACCOUNT_DIR, { recursive: true, force: true });
}

test('PATCH /api/system/openai-api-key accepts a valid string key and persists it', async () => {
  cleanupAccountDir();
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'PATCH',
      url: '/api/system/openai-api-key',
      headers: HEADERS_JSON,
      payload: { api_key: 'sk-test-key-123' },
    });
    assert.equal(resp.statusCode, 200);
    assert.deepEqual(resp.json(), { ok: true, has_key: true });

    const status = await app.inject({
      method: 'GET',
      url: '/api/system/openai-key-status',
      headers: HEADERS_JSON,
    });
    assert.equal((status.json() as { has_key: boolean }).has_key, true);
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});

test('PATCH /api/system/openai-api-key treats a missing api_key as clearing the key', async () => {
  cleanupAccountDir();
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'PATCH',
      url: '/api/system/openai-api-key',
      headers: HEADERS_JSON,
      payload: {},
    });
    assert.equal(resp.statusCode, 200);
    assert.deepEqual(resp.json(), { ok: true, has_key: false });
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});

test('PATCH /api/system/openai-api-key treats an empty string api_key as clearing the key', async () => {
  cleanupAccountDir();
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'PATCH',
      url: '/api/system/openai-api-key',
      headers: HEADERS_JSON,
      payload: { api_key: '   ' },
    });
    assert.equal(resp.statusCode, 200);
    assert.deepEqual(resp.json(), { ok: true, has_key: false });
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});

test('PATCH /api/system/openai-api-key rejects a non-string api_key with 400 instead of throwing', async () => {
  cleanupAccountDir();
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'PATCH',
      url: '/api/system/openai-api-key',
      headers: HEADERS_JSON,
      payload: { api_key: 12345 },
    });
    assert.equal(resp.statusCode, 400);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'INVALID_REQUEST');
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});

test('PATCH /api/system/openai-api-key rejects a non-object body with 400', async () => {
  cleanupAccountDir();
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'PATCH',
      url: '/api/system/openai-api-key',
      headers: HEADERS_JSON,
      payload: JSON.stringify('not-an-object'),
    });
    assert.equal(resp.statusCode, 400);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'INVALID_REQUEST');
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});

test('PATCH /api/system/ai-settings stores separate OpenAI, CGU Air, and OpenRouter settings', async () => {
  cleanupAccountDir();
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'PATCH',
      url: '/api/system/ai-settings',
      headers: HEADERS_JSON,
      payload: {
        openai_api_key: 'sk-openai',
        openai_llm_model: 'gpt-4o-mini',
        cgu_air_api_key: 'sk-cgu-air',
        cgu_air_base_url: 'https://air.cgu.edu.tw/cgullmapi/v1',
        cgu_air_llm_model: 'cgu-gpt-4o-mini',
        openrouter_api_key: 'sk-or-test',
        openrouter_base_url: 'https://openrouter.ai/api/v1',
        openrouter_llm_model: 'openai/gpt-4o-mini',
        llm_provider: 'openrouter',
      },
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as Record<string, unknown>;
    assert.equal(body.openai_api_key, 'sk-openai');
    assert.equal(body.cgu_air_api_key, 'sk-cgu-air');
    assert.equal(body.openrouter_api_key, 'sk-or-test');
    assert.equal(body.llm_provider, 'openrouter');
    assert.equal(body.openrouter_llm_model, 'openai/gpt-4o-mini');

    const envPath = path.join(ACCOUNT_DIR, 'settings.env');
    const content = fs.readFileSync(envPath, 'utf8');
    assert.match(content, /^OPENAI_API_KEY=sk-openai$/m);
    assert.match(content, /^CGU_AIR_API_KEY=sk-cgu-air$/m);
    assert.match(content, /^OPENROUTER_API_KEY=sk-or-test$/m);
    assert.match(content, /^LLM_PROVIDER=openrouter$/m);
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});

test('PATCH /api/system/ai-settings rejects unsupported LLM provider', async () => {
  cleanupAccountDir();
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'PATCH',
      url: '/api/system/ai-settings',
      headers: HEADERS_JSON,
      payload: { llm_provider: 'not-a-provider' },
    });
    assert.equal(resp.statusCode, 400);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'INVALID_REQUEST');
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});
