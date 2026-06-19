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
