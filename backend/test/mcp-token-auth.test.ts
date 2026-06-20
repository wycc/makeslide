import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, timingSafeStringEqual } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

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
  });
  const originalToken = config.mcpAuthToken;
  config.mcpAuthToken = 'mcp-test-secret-token';
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
        headers: { authorization: `Bearer ${config.mcpAuthToken}` },
      });
      assert.notEqual(withCorrectToken.statusCode, 401);
    } finally {
      await app.close();
    }
  } finally {
    config.mcpAuthToken = originalToken;
    setSystemAuthSettings({ googleAuthEnabled: false });
  }
});
