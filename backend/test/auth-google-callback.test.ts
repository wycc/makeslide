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

test('Google OAuth callback passes an AbortSignal to both the token and userinfo requests', async () => {
  configureGoogleAuth();
  const originalFetch = globalThis.fetch;
  const capturedSignals: Array<AbortSignal | null | undefined> = [];
  globalThis.fetch = (async (input, init) => {
    capturedSignals.push((init as RequestInit | undefined)?.signal);
    const url = String(input);
    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'access-token', token_type: 'Bearer' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ sub: 'google-sub-1', email: 'user@example.test' }), {
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
    assert.equal(res.statusCode, 302);
    assert.equal(capturedSignals.length, 2);
    for (const signal of capturedSignals) {
      assert.ok(signal instanceof AbortSignal, 'expected a fetch signal to be passed');
      assert.equal(signal!.aborted, false);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test('Google OAuth callback returns 502 (not an uncaught exception) when the token exchange connection fails or times out', async () => {
  configureGoogleAuth();
  const originalFetch = globalThis.fetch;
  // A real AbortSignal.timeout() firing rejects fetch() with this same DOMException — exercising the
  // catch path here is equivalent to the real timeout without the test actually waiting 15s for it.
  globalThis.fetch = (async () => {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }) as typeof fetch;

  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=test-code&state=${STATE}`,
      headers: { cookie: OAUTH_COOKIE, host: 'example.test' },
    });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, 'GOOGLE_TOKEN_EXCHANGE_FAILED');
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test('Google OAuth callback returns 502 (not an uncaught exception) when the userinfo connection fails or times out', async () => {
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
    throw new DOMException('The operation was aborted.', 'AbortError');
  }) as typeof fetch;

  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=test-code&state=${STATE}`,
      headers: { cookie: OAUTH_COOKIE, host: 'example.test' },
    });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, 'GOOGLE_USERINFO_FAILED');
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
