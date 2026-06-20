import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp, timingSafeStringEqual } from '../src/server';
import { config } from '../src/config';
import { getSystemAuthSettings, setSystemAuthSettings } from '../src/services/aiSettings';

function makeSessionCookie(sub: string): string {
  const session = { provider: 'google', sub, email: `${sub}@example.com` };
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const ADMIN_SESSION_COOKIE = makeSessionCookie('account-1');
const NON_ADMIN_SESSION_COOKIE = makeSessionCookie('account-2');
const ADMIN_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(ADMIN_SESSION_COOKIE)}` };
const NON_ADMIN_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(NON_ADMIN_SESSION_COOKIE)}` };

test('timingSafeStringEqual returns true only for an exact match', () => {
  assert.equal(timingSafeStringEqual('Bearer secret-token', 'Bearer secret-token'), true);
});

test('timingSafeStringEqual returns false for different content of the same length', () => {
  assert.equal(timingSafeStringEqual('Bearer secret-token', 'Bearer wrongg-token'), false);
});

test('timingSafeStringEqual returns false (not throw) for inputs of different lengths', () => {
  assert.doesNotThrow(() => {
    assert.equal(timingSafeStringEqual('Bearer short', 'Bearer a-much-longer-token-value'), false);
  });
  assert.equal(timingSafeStringEqual('', 'Bearer secret-token'), false);
});

test('MCP bearer token grants API access when Google login is otherwise required', async () => {
  setSystemAuthSettings({
    googleAuthEnabled: true,
    googleClientId: 'test-client.apps.googleusercontent.com',
    googleClientSecret: 'test-secret',
    googleRedirectUri: 'https://example.test/api/auth/google/callback',
    adminAccountIds: [],
    mcpAuthToken: 'mcp-test-secret-token',
  });
  try {
    const app = await buildApp();
    try {
      const unauthorized = await app.inject({ method: 'GET', url: '/api/pdfs' });
      assert.equal(unauthorized.statusCode, 401);

      const withWrongToken = await app.inject({
        method: 'GET',
        url: '/api/pdfs',
        headers: { authorization: 'Bearer wrong-token' },
      });
      assert.equal(withWrongToken.statusCode, 401);

      const withCorrectToken = await app.inject({
        method: 'GET',
        url: '/api/pdfs',
        headers: { authorization: 'Bearer mcp-test-secret-token' },
      });
      assert.notEqual(withCorrectToken.statusCode, 401);
    } finally {
      await app.close();
    }
  } finally {
    setSystemAuthSettings({ googleAuthEnabled: false, mcpAuthToken: config.mcpAuthToken });
  }
});

test('POST /api/system/mcp-auth-token generates and saves a strong one-time token for admins', async () => {
  setSystemAuthSettings({
    googleAuthEnabled: false,
    adminAccountIds: ['account-1'],
    mcpAuthToken: '',
  });
  const app = await buildApp();
  try {
    const forbidden = await app.inject({ method: 'POST', url: '/api/system/mcp-auth-token', headers: NON_ADMIN_HEADERS });
    assert.equal(forbidden.statusCode, 403);

    const generated = await app.inject({ method: 'POST', url: '/api/system/mcp-auth-token', headers: ADMIN_HEADERS });
    assert.equal(generated.statusCode, 200);
    const body = generated.json() as { ok: boolean; token: string; has_mcp_auth_token: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.has_mcp_auth_token, true);
    assert.match(body.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(getSystemAuthSettings().mcpAuthToken, body.token);

    const settings = await app.inject({ method: 'GET', url: '/api/system/ai-settings', headers: ADMIN_HEADERS });
    assert.equal(settings.statusCode, 200);
    const settingsBody = settings.json() as { has_mcp_auth_token?: boolean; mcp_auth_token?: string };
    assert.equal(settingsBody.has_mcp_auth_token, true);
    assert.equal(settingsBody.mcp_auth_token, undefined);
  } finally {
    await app.close();
    setSystemAuthSettings({ adminAccountIds: [], mcpAuthToken: '' });
  }
});
