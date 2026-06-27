import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyRequest } from 'fastify';
import { sessionSub, encodeSession } from '../src/routes/auth';

function req(cookie?: string): FastifyRequest {
  return { headers: cookie ? { cookie } : {} } as unknown as FastifyRequest;
}

test('sessionSub returns null when there is no cookie', () => {
  assert.equal(sessionSub(req()), null);
});

test('sessionSub returns null for an invalid / tampered session cookie', () => {
  assert.equal(sessionSub(req('makeslide_session=not.a.valid.token')), null);
});

test('sessionSub returns the account sub for a valid session cookie', () => {
  const token = encodeSession({ provider: 'google', sub: 'acct-123', email: 'a@example.com' });
  assert.equal(sessionSub(req(`makeslide_session=${encodeURIComponent(token)}`)), 'acct-123');
});

test('sessionSub ignores unrelated cookies', () => {
  assert.equal(sessionSub(req('other=1; another=2')), null);
});
