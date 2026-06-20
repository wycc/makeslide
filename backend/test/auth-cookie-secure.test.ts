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

function withNodeEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const original = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  return fn().finally(() => {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  });
}

test('GET /api/auth/google/start sets the oauth-state cookie with Secure in production', async () => {
  configureGoogleAuth();
  await withNodeEnv('production', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
      const cookie = res.headers['set-cookie'];
      const header = Array.isArray(cookie) ? cookie[0] : cookie;
      assert.ok(header?.includes('Secure'), `expected Secure in: ${header}`);
      assert.ok(header?.includes('HttpOnly'));
      assert.ok(header?.includes('SameSite=Lax'));
    } finally {
      await app.close();
    }
  });
});

test('GET /api/auth/google/start omits Secure outside production so local http:// dev login still works', async () => {
  configureGoogleAuth();
  await withNodeEnv('test', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
      const cookie = res.headers['set-cookie'];
      const header = Array.isArray(cookie) ? cookie[0] : cookie;
      assert.ok(header && !header.includes('Secure'), `expected no Secure in: ${header}`);
      assert.ok(header?.includes('HttpOnly'));
    } finally {
      await app.close();
    }
  });
});

test('POST /api/auth/logout clears the session cookie with Secure in production', async () => {
  await withNodeEnv('production', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
      const cookie = res.headers['set-cookie'];
      const header = Array.isArray(cookie) ? cookie[0] : cookie;
      assert.ok(header?.includes('Secure'), `expected Secure in: ${header}`);
      assert.ok(header?.includes('Max-Age=0'));
    } finally {
      await app.close();
    }
  });
});

test('POST /api/auth/logout omits Secure outside production', async () => {
  await withNodeEnv('test', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
      const cookie = res.headers['set-cookie'];
      const header = Array.isArray(cookie) ? cookie[0] : cookie;
      assert.ok(header && !header.includes('Secure'), `expected no Secure in: ${header}`);
    } finally {
      await app.close();
    }
  });
});
