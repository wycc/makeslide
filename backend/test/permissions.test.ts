import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadPdf, canEditPdf, canDestructivelyEditPdf } from '../src/routes/pdfs/permissions';

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

test('canEditPdf: ownerless editable, owner editable, others only when public_editable', () => {
  assert.equal(canEditPdf(null, { owner_sub: null, visibility: 'private' }), true);
  assert.equal(canEditPdf('u1', { owner_sub: 'u1', visibility: 'private' }), true);
  assert.equal(canEditPdf('u2', { owner_sub: 'u1', visibility: 'public_editable' }), true);
  // public (read-only) is NOT editable by a non-owner
  assert.equal(canEditPdf('u2', { owner_sub: 'u1', visibility: 'public' }), false);
  assert.equal(canEditPdf('u2', { owner_sub: 'u1', visibility: 'private' }), false);
  // unlike read access, public_editable allows even an anonymous editor here
  assert.equal(canEditPdf(null, { owner_sub: 'u1', visibility: 'public_editable' }), true);
});

test('canDestructivelyEditPdf is like canEditPdf but forbids anonymous public_editable', () => {
  assert.equal(canDestructivelyEditPdf(null, { owner_sub: null, visibility: 'private' }), true);
  assert.equal(canDestructivelyEditPdf('u1', { owner_sub: 'u1', visibility: 'private' }), true);
  // signed-in non-owner can destructively edit a public_editable PDF
  assert.equal(canDestructivelyEditPdf('u2', { owner_sub: 'u1', visibility: 'public_editable' }), true);
  // but an anonymous request CANNOT, even on public_editable (key difference vs canEditPdf)
  assert.equal(canDestructivelyEditPdf(null, { owner_sub: 'u1', visibility: 'public_editable' }), false);
  assert.equal(canEditPdf(null, { owner_sub: 'u1', visibility: 'public_editable' }), true);
  // public (read-only) is never destructively editable by a non-owner
  assert.equal(canDestructivelyEditPdf('u2', { owner_sub: 'u1', visibility: 'public' }), false);
});
