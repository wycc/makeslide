import test from 'node:test';
import assert from 'node:assert/strict';
import { groupVotersByOption, isAnonymousVoterId } from './PollResultsDialog';
import type { PagePollVoter } from '../../types';

function voter(voter_id: string, option_index: number): PagePollVoter {
  return { voter_id, option_index, option_text: `opt-${option_index}`, voted_at: '2026-06-29T00:00:00.000Z' };
}

test('groupVotersByOption buckets voters by their option index, preserving order', () => {
  const grouped = groupVotersByOption([
    voter('alice', 0),
    voter('bob', 1),
    voter('carol', 0),
  ]);
  assert.deepEqual(grouped.get(0)?.map((v) => v.voter_id), ['alice', 'carol']);
  assert.deepEqual(grouped.get(1)?.map((v) => v.voter_id), ['bob']);
  assert.equal(grouped.get(2), undefined);
});

test('groupVotersByOption returns an empty map for no voters', () => {
  assert.equal(groupVotersByOption([]).size, 0);
});

test('isAnonymousVoterId flags only auto-generated voter ids', () => {
  assert.equal(isAnonymousVoterId('voter-1717000000000-abc'), true);
  assert.equal(isAnonymousVoterId('alice'), false);
  assert.equal(isAnonymousVoterId('S1234567'), false);
});
