import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyRequest } from 'fastify';
import { getShareToken, ShareTokenParamSchema } from '../src/routes/pdfs/share';

function req(opts: { header?: string | string[]; query?: Record<string, unknown> }): FastifyRequest {
  return {
    headers: opts.header !== undefined ? { 'x-makeslide-share-token': opts.header } : {},
    query: opts.query,
  } as unknown as FastifyRequest;
}

test('getShareToken reads the x-makeslide-share-token header', () => {
  assert.equal(getShareToken(req({ header: 'tok-from-header' })), 'tok-from-header');
});

test('getShareToken falls back to the ?share= query param', () => {
  assert.equal(getShareToken(req({ query: { share: 'tok-from-query' } })), 'tok-from-query');
});

test('getShareToken prefers the header over the query param', () => {
  assert.equal(getShareToken(req({ header: 'h', query: { share: 'q' } })), 'h');
});

test('getShareToken trims and ignores blank / missing values', () => {
  assert.equal(getShareToken(req({ header: '  spaced  ' })), 'spaced');
  assert.equal(getShareToken(req({ header: '   ' })), null);
  assert.equal(getShareToken(req({})), null);
});

test('getShareToken handles array-valued header/query (takes the first)', () => {
  assert.equal(getShareToken(req({ header: ['a', 'b'] })), 'a');
});

test('ShareTokenParamSchema accepts 12–128 url-safe chars and rejects others', () => {
  assert.equal(ShareTokenParamSchema.safeParse({ token: 'a'.repeat(12) }).success, true);
  assert.equal(ShareTokenParamSchema.safeParse({ token: 'abc' }).success, false); // too short
  assert.equal(ShareTokenParamSchema.safeParse({ token: 'has space 123456' }).success, false);
  assert.equal(ShareTokenParamSchema.safeParse({ token: 'A-_'.repeat(10) }).success, true);
});
