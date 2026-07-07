import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { deriveWsUrl } from '../src/routes/jupyter';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(
    JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }),
    'utf8',
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.authSessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

const AUTH_HEADERS = {
  cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`,
};

// config is `as const` (readonly at the type level) but a plain mutable object at
// runtime; flip its Jupyter fields per-case since it is evaluated once at import.
function withJupyterConfig(
  patch: Partial<Pick<typeof config, 'jupyterEnabled' | 'jupyterBaseUrl' | 'jupyterToken'>>,
): () => void {
  const prev = {
    jupyterEnabled: config.jupyterEnabled,
    jupyterBaseUrl: config.jupyterBaseUrl,
    jupyterToken: config.jupyterToken,
  };
  Object.assign(config as Record<string, unknown>, patch);
  return () => Object.assign(config as Record<string, unknown>, prev);
}

test('deriveWsUrl maps http(s) → ws(s) and passes through empty/other', () => {
  assert.equal(deriveWsUrl(''), '');
  assert.equal(deriveWsUrl('http://localhost:8888'), 'ws://localhost:8888');
  assert.equal(deriveWsUrl('https://hub.example/user/x'), 'wss://hub.example/user/x');
  assert.equal(deriveWsUrl('ws://already'), 'ws://already');
});

test('GET /api/jupyter/connection 404s when the feature is disabled', async () => {
  const restore = withJupyterConfig({ jupyterEnabled: false });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection', headers: AUTH_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
    restore();
  }
});

test('GET /api/jupyter/connection 401s when enabled but unauthenticated', async () => {
  const restore = withJupyterConfig({ jupyterEnabled: true, jupyterBaseUrl: '', jupyterToken: '' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection' });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
    restore();
  }
});

test('GET /api/jupyter/connection returns same-origin shape (no token) in cookie mode', async () => {
  const restore = withJupyterConfig({ jupyterEnabled: true, jupyterBaseUrl: '', jupyterToken: 'ignored' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection', headers: AUTH_HEADERS });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.enabled, true);
    assert.equal(body.baseUrl, '');
    assert.equal(body.wsUrl, '');
    // Same-origin cookie mode must never leak a token to the frontend.
    assert.equal(body.token, '');
    assert.equal(typeof body.nbPrefix, 'string');
  } finally {
    await app.close();
    restore();
  }
});

test('GET /api/jupyter/connection returns explicit URL + token in dev/desktop mode', async () => {
  const restore = withJupyterConfig({
    jupyterEnabled: true,
    jupyterBaseUrl: 'https://hub.example/user/x',
    jupyterToken: 'secret-token',
  });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection', headers: AUTH_HEADERS });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.baseUrl, 'https://hub.example/user/x');
    assert.equal(body.wsUrl, 'wss://hub.example/user/x');
    assert.equal(body.token, 'secret-token');
  } finally {
    await app.close();
    restore();
  }
});
