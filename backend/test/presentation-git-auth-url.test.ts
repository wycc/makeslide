import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthenticatedRepoUrl } from '../src/services/presentationGit';

// buildAuthenticatedRepoUrl embeds the GitHub token into an https remote for
// pushing. These cases lock the security-relevant behaviour: a token is only
// embedded into http(s) URLs, never into SSH/scp-style remotes, and token
// characters are percent-encoded so they cannot break the URL structure.

test('returns the URL unchanged when no token is given', () => {
  assert.equal(buildAuthenticatedRepoUrl('https://github.com/o/r.git', ''), 'https://github.com/o/r.git');
  assert.equal(buildAuthenticatedRepoUrl('https://github.com/o/r.git', '   '), 'https://github.com/o/r.git');
});

test('embeds the token as x-access-token for an https URL', () => {
  assert.equal(
    buildAuthenticatedRepoUrl('https://github.com/o/r.git', 'ghp_TOKEN123'),
    'https://x-access-token:ghp_TOKEN123@github.com/o/r.git',
  );
});

test('does not embed the token into SSH / scp-style remotes', () => {
  assert.equal(buildAuthenticatedRepoUrl('git@github.com:o/r.git', 'ghp_TOKEN123'), 'git@github.com:o/r.git');
  assert.equal(buildAuthenticatedRepoUrl('ssh://git@github.com/o/r.git', 'ghp_TOKEN123'), 'ssh://git@github.com/o/r.git');
});

test('returns a malformed URL unchanged instead of throwing', () => {
  assert.equal(buildAuthenticatedRepoUrl('not a url', 'ghp_TOKEN123'), 'not a url');
});

test('percent-encodes token characters that would otherwise break the URL', () => {
  assert.equal(
    buildAuthenticatedRepoUrl('https://github.com/o/r.git', 'tok/with:special@chars'),
    'https://x-access-token:tok%2Fwith%3Aspecial%40chars@github.com/o/r.git',
  );
});
