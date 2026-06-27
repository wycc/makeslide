import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadPdf } from '../src/routes/pdfs/permissions';

test('ownerless PDFs are readable by anyone', () => {
  assert.equal(canReadPdf(null, { owner_sub: null, visibility: 'private' }), true);
  assert.equal(canReadPdf('someone', { owner_sub: null, visibility: 'private' }), true);
});

test('owner can read their own PDF regardless of visibility', () => {
  assert.equal(canReadPdf('u1', { owner_sub: 'u1', visibility: 'private' }), true);
});

test('non-owner can read only public / public_editable PDFs', () => {
  assert.equal(canReadPdf('u2', { owner_sub: 'u1', visibility: 'private' }), false);
  assert.equal(canReadPdf(null, { owner_sub: 'u1', visibility: 'private' }), false);
  assert.equal(canReadPdf('u2', { owner_sub: 'u1', visibility: 'public' }), true);
  assert.equal(canReadPdf('u2', { owner_sub: 'u1', visibility: 'public_editable' }), true);
  assert.equal(canReadPdf(null, { owner_sub: 'u1', visibility: 'public' }), true);
});
