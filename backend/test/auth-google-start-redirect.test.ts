import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/server';
import { setSystemAuthSettings } from '../src/services/aiSettings';

function configureGoogleAuth(): void {
  setSystemAuthSettings({
    googleAuthEnabled: true,
    googleClientId: 'test-client.apps.googleusercontent.com',
    googleClientSecret: 'test-secret',
    googleRedirectUri: 'https://example.test/api/auth/google/callback',
    adminAccountIds: [],
  });
}

function setCookieHeaders(res: { headers: { 'set-cookie'?: string | string[] } }): string[] {
  const cookie = res.headers['set-cookie'];
  if (!cookie) return [];
  return Array.isArray(cookie) ? cookie : [cookie];
}

test('GET /api/auth/google/start stores a valid redirect target for the callback to use', async () => {
  configureGoogleAuth();
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/google/start?redirect=${encodeURIComponent('#/play/abc123?share=xyz')}`,
    });
    const cookies = setCookieHeaders(res);
    const redirectCookie = cookies.find((c) => c.startsWith('makeslide_oauth_redirect='));
    assert.ok(redirectCookie, `expected a makeslide_oauth_redirect cookie in: ${cookies.join(' | ')}`);
    assert.ok(redirectCookie.includes(encodeURIComponent('#/play/abc123?share=xyz')));
  } finally {
    await app.close();
  }
});

test('GET /api/auth/google/start ignores an unsafe redirect target (does not store it)', async () => {
  configureGoogleAuth();
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/google/start?redirect=${encodeURIComponent('https://evil.test/phish')}`,
    });
    const cookies = setCookieHeaders(res);
    const redirectCookie = cookies.find((c) => c.startsWith('makeslide_oauth_redirect='));
    assert.ok(redirectCookie, `expected a makeslide_oauth_redirect cookie in: ${cookies.join(' | ')}`);
    assert.ok(redirectCookie.startsWith('makeslide_oauth_redirect=;'), `expected the cookie to be cleared, got: ${redirectCookie}`);
  } finally {
    await app.close();
  }
});

test('GET /api/auth/google/start without a redirect query param clears any stale redirect cookie', async () => {
  configureGoogleAuth();
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    const cookies = setCookieHeaders(res);
    const redirectCookie = cookies.find((c) => c.startsWith('makeslide_oauth_redirect='));
    assert.ok(redirectCookie, `expected a makeslide_oauth_redirect cookie in: ${cookies.join(' | ')}`);
    assert.ok(redirectCookie.startsWith('makeslide_oauth_redirect=;'), `expected the cookie to be cleared, got: ${redirectCookie}`);
  } finally {
    await app.close();
  }
});
