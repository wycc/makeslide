import test from 'node:test';
import assert from 'node:assert/strict';

import { shareStatusBadges } from './shareStatusBadges';

test('shareStatusBadges renders nothing for a presentation that is not ours', () => {
  // The backend only sends the counts to the owner, so their absence means "not
  // my deck" - who else it was shared with is none of our business. This must
  // stay distinct from an empty array, which means "mine, and not shared".
  assert.equal(shareStatusBadges({ visibility: 'public' }), null);
  assert.equal(shareStatusBadges({ visibility: 'private' }, { showWhenPrivate: true }), null);
});

test('shareStatusBadges reports a private, unshared deck as empty unless asked otherwise', () => {
  const pdf = { visibility: 'private' as const, share_link_count: 0, share_user_count: 0, share_group_count: 0 };

  assert.deepEqual(shareStatusBadges(pdf), []);
  assert.deepEqual(shareStatusBadges(pdf, { showWhenPrivate: true }), [{ kind: 'private' }]);
});

test('shareStatusBadges distinguishes public from public_editable', () => {
  assert.deepEqual(
    shareStatusBadges({ visibility: 'public', share_link_count: 0 }),
    [{ kind: 'public' }],
  );
  assert.deepEqual(
    shareStatusBadges({ visibility: 'public_editable', share_link_count: 0 }),
    [{ kind: 'public_editable' }],
  );
});

test('shareStatusBadges counts links, users and groups, in that order', () => {
  const badges = shareStatusBadges({
    visibility: 'private',
    share_link_count: 2,
    share_user_count: 3,
    share_group_count: 1,
  });

  assert.deepEqual(badges, [
    { kind: 'links', count: 2 },
    { kind: 'users', count: 3 },
    { kind: 'groups', count: 1 },
  ]);
});

test('shareStatusBadges puts expired links last, after the ways in that still work', () => {
  const badges = shareStatusBadges({
    visibility: 'public',
    share_link_count: 1,
    share_expired_link_count: 4,
    share_user_count: 0,
    share_group_count: 0,
  });

  assert.deepEqual(badges, [
    { kind: 'public' },
    { kind: 'links', count: 1 },
    { kind: 'expired', count: 4 },
  ]);
});

test('shareStatusBadges treats a deck whose only link has expired as not shared', () => {
  // An expired link is not a way in, so this deck is effectively private - but
  // the expiry is still worth surfacing so the owner knows why the link died.
  const pdf = {
    visibility: 'private' as const,
    share_link_count: 0,
    share_expired_link_count: 2,
    share_user_count: 0,
    share_group_count: 0,
  };

  assert.deepEqual(shareStatusBadges(pdf), [{ kind: 'expired', count: 2 }]);
  assert.deepEqual(shareStatusBadges(pdf, { showWhenPrivate: true }), [
    { kind: 'private' },
    { kind: 'expired', count: 2 },
  ]);
});
