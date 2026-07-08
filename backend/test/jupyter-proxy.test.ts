import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { config } from '../src/config';
import { encodeSession } from '../src/routes/auth';
import { jupyterProxyEnabled, jupyterProxyMountPath, sessionSubFromCookieHeader } from '../src/routes/jupyterProxy';

test('jupyterProxyEnabled requires the feature on and a target', () => {
  assert.equal(jupyterProxyEnabled({ jupyterEnabled: true, jupyterProxyTarget: 'http://127.0.0.1:8888' }), true);
  assert.equal(jupyterProxyEnabled({ jupyterEnabled: false, jupyterProxyTarget: 'http://127.0.0.1:8888' }), false);
  assert.equal(jupyterProxyEnabled({ jupyterEnabled: true, jupyterProxyTarget: '' }), false);
});

test('jupyterProxyMountPath joins NB_PREFIX and PROXY_PREFIX, normalizing slashes', () => {
  assert.equal(jupyterProxyMountPath({ nbPrefix: '', jupyterProxyPrefix: '/jupyter' }), '/jupyter');
  assert.equal(jupyterProxyMountPath({ nbPrefix: '/user/x', jupyterProxyPrefix: '/jupyter' }), '/user/x/jupyter');
  assert.equal(jupyterProxyMountPath({ nbPrefix: '', jupyterProxyPrefix: 'jupyter' }), '/jupyter'); // missing leading slash
  assert.equal(jupyterProxyMountPath({ nbPrefix: '', jupyterProxyPrefix: '/jupyter/' }), '/jupyter'); // trailing slash
});

function cookieFor(sub: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(encodeSession({ provider: 'google', sub, email: `${sub}@example.com` }))}`;
}
const SESSION_COOKIE_NAME = 'makeslide_session';

test('sessionSubFromCookieHeader validates a signed session cookie (used for the WS handshake)', () => {
  assert.equal(sessionSubFromCookieHeader(cookieFor('user-1')), 'user-1');
  // extra cookies alongside are tolerated
  assert.equal(sessionSubFromCookieHeader(`other=1; ${cookieFor('user-2')}; x=y`), 'user-2');
});

test('sessionSubFromCookieHeader rejects missing, malformed, and tampered cookies', () => {
  assert.equal(sessionSubFromCookieHeader(undefined), null);
  assert.equal(sessionSubFromCookieHeader(''), null);
  assert.equal(sessionSubFromCookieHeader('makeslide_session=garbage'), null);
  // valid structure but wrong signature
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub: 'x', email: 'x@e.com' }), 'utf8').toString('base64url');
  const badSig = crypto.createHmac('sha256', 'wrong-secret').update(payload).digest('base64url');
  assert.equal(sessionSubFromCookieHeader(`makeslide_session=${payload}.${badSig}`), null);
  void config; // ensure config module (and thus auth secret) is initialized
});
