import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/server';
import { setSystemAuthSettings } from '../src/services/aiSettings';

const STATE = 'oauth-state-test';
const OAUTH_COOKIE = `makeslide_oauth_state=${STATE}`;

function configureGoogleAuth(): void {
  setSystemAuthSettings({
    googleAuthEnabled: true,
    googleClientId: 'test-client.apps.googleusercontent.com',
    googleClientSecret: 'test-secret',
    googleRedirectUri: 'https://example.test/api/auth/google/callback',
    adminAccountIds: [],
  });
}

test('Google OAuth callback returns 502 when token response JSON does not match schema', async () => {
  configureGoogleAuth();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ token_type: 'Bearer' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=test-code&state=${STATE}`,
      headers: { cookie: OAUTH_COOKIE, host: 'example.test' },
    });

    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, 'GOOGLE_TOKEN_PARSE_FAILED');
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test('Google OAuth callback returns 502 when userinfo response JSON does not match schema', async () => {
  configureGoogleAuth();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'access-token', token_type: 'Bearer' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ sub: 'google-sub-without-email' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=test-code&state=${STATE}`,
      headers: { cookie: OAUTH_COOKIE, host: 'example.test' },
    });

    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, 'GOOGLE_USERINFO_PARSE_FAILED');
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
