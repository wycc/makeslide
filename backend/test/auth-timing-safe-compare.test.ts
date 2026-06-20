import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { decodeSession, timingSafeStringEqual } from '../src/routes/auth';
import { setSystemAuthSettings } from '../src/services/aiSettings';

function signedSessionValue(session: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

// ── timingSafeStringEqual ────────────────────────────────────────────────

test('timingSafeStringEqual returns true only for an exact match', () => {
  assert.equal(timingSafeStringEqual('abc123signature', 'abc123signature'), true);
});

test('timingSafeStringEqual returns false for different content of the same length', () => {
  assert.equal(timingSafeStringEqual('abc123signature', 'xyz123signature'), false);
});

test('timingSafeStringEqual returns false (not throw) for inputs of different lengths', () => {
  assert.doesNotThrow(() => {
    assert.equal(timingSafeStringEqual('short', 'a-much-longer-value'), false);
  });
  assert.equal(timingSafeStringEqual('', 'non-empty'), false);
});

// ── decodeSession ────────────────────────────────────────────────────────

test('decodeSession accepts a correctly signed session value', () => {
  const value = signedSessionValue({ provider: 'google', sub: 'sub-1', email: 'user@example.test' });
  const session = decodeSession(value);
  assert.deepEqual(session, { provider: 'google', sub: 'sub-1', email: 'user@example.test' });
});

test('decodeSession rejects a session value with a tampered signature', () => {
  const value = signedSessionValue({ provider: 'google', sub: 'sub-1', email: 'user@example.test' });
  const [payload] = value.split('.');
  const tampered = `${payload}.not-the-real-signature-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
  assert.equal(decodeSession(tampered), null);
});

test('decodeSession rejects a session value whose payload was modified without re-signing', () => {
  const value = signedSessionValue({ provider: 'google', sub: 'sub-1', email: 'user@example.test' });
  const [, signature] = value.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ provider: 'google', sub: 'admin-account', email: 'admin@example.test' }), 'utf8').toString('base64url');
  assert.equal(decodeSession(`${forgedPayload}.${signature}`), null);
});

test('decodeSession rejects malformed input without throwing', () => {
  assert.equal(decodeSession(undefined), null);
  assert.equal(decodeSession(''), null);
  assert.equal(decodeSession('no-dot-separator'), null);
});

// ── OAuth state (CSRF) comparison ────────────────────────────────────────

test('Google OAuth callback rejects a mismatched state with INVALID_OAUTH_STATE', async () => {
  setSystemAuthSettings({
    googleAuthEnabled: true,
    googleClientId: 'test-client.apps.googleusercontent.com',
    googleClientSecret: 'test-secret',
    googleRedirectUri: 'https://example.test/api/auth/google/callback',
    adminAccountIds: [],
  });
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/google/callback?code=test-code&state=attacker-supplied-state',
      headers: { cookie: 'makeslide_oauth_state=the-real-state', host: 'example.test' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'INVALID_OAUTH_STATE');
  } finally {
    await app.close();
  }
});
