import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeckReadOnly, type DeckReadOnlyInput } from './deckAccess';

/** Base: a non-owner viewer with no token on a private deck (access resolved to none). */
const base: DeckReadOnlyInput = {
  isOwner: false,
  shareMode: undefined,
  visibility: 'private',
  accessLevel: 'none',
  hasShareToken: false,
};

test('the owner is never read-only, whatever the share mode / visibility', () => {
  assert.equal(resolveDeckReadOnly({ ...base, isOwner: true }), false);
  assert.equal(resolveDeckReadOnly({ ...base, isOwner: true, shareMode: 'read_only', hasShareToken: true }), false);
  assert.equal(resolveDeckReadOnly({ ...base, isOwner: true, visibility: 'public' }), false);
});

test('an effective edit level (read-write grant or editable token) is read-write for a non-owner', () => {
  assert.equal(resolveDeckReadOnly({ ...base, accessLevel: 'edit' }), false);
  // editable token on a private deck: share_mode editable, token present, effective edit
  assert.equal(
    resolveDeckReadOnly({ ...base, shareMode: 'editable', hasShareToken: true, accessLevel: 'edit' }),
    false,
  );
});

test('an effective read level (read-only grant/default) is read-only', () => {
  assert.equal(resolveDeckReadOnly({ ...base, accessLevel: 'read' }), true);
});

test('a read-only share link is read-only for a non-owner', () => {
  assert.equal(resolveDeckReadOnly({ ...base, shareMode: 'read_only', hasShareToken: true, accessLevel: 'read' }), true);
  // even if access_level were somehow reported lower, the explicit read_only share_mode still locks it
  assert.equal(resolveDeckReadOnly({ ...base, shareMode: 'read_only', hasShareToken: true, accessLevel: 'none' }), true);
});

test('a public (read-only) deck opened without a token is read-only for a non-owner', () => {
  assert.equal(resolveDeckReadOnly({ ...base, visibility: 'public', accessLevel: 'read' }), true);
  // ...but the same public deck opened WITH an editable token is read-write (token wins → edit)
  assert.equal(
    resolveDeckReadOnly({ ...base, visibility: 'public', hasShareToken: true, shareMode: 'editable', accessLevel: 'edit' }),
    false,
  );
});

test('an editable token holder is read-write even though the deck default is private', () => {
  assert.equal(
    resolveDeckReadOnly({ isOwner: false, shareMode: 'editable', visibility: 'private', accessLevel: 'edit', hasShareToken: true }),
    false,
  );
});

test('undefined fields (still loading) do not force read-only via the non-owner branch', () => {
  // no access level, no share mode, unknown visibility, no token → not read-only (yet)
  assert.equal(
    resolveDeckReadOnly({ isOwner: false, shareMode: undefined, visibility: undefined, accessLevel: undefined, hasShareToken: false }),
    false,
  );
});
