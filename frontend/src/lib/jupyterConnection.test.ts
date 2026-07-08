import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  httpToWs,
  iopubMessageFrom,
  kernelStatusFrom,
  kernelStatusLabelKey,
  isJupyterDisabledError,
  resolveJupyterUrls,
  type JupyterConnectionInfo,
} from './jupyterConnection';

function info(overrides: Partial<JupyterConnectionInfo> = {}): JupyterConnectionInfo {
  return { enabled: true, baseUrl: '', wsUrl: '', nbPrefix: '', token: '', ...overrides };
}

test('httpToWs converts scheme, leaves others unchanged', () => {
  assert.equal(httpToWs('http://h:8888'), 'ws://h:8888');
  assert.equal(httpToWs('https://h'), 'wss://h');
  assert.equal(httpToWs('wss://h'), 'wss://h');
});

test('resolveJupyterUrls uses explicit URLs when provided', () => {
  const urls = resolveJupyterUrls(info({ baseUrl: 'http://localhost:8888/', wsUrl: 'ws://localhost:8888' }), 'https://app.example');
  assert.deepEqual(urls, { baseUrl: 'http://localhost:8888', wsUrl: 'ws://localhost:8888' });
});

test('resolveJupyterUrls derives ws from explicit base when wsUrl empty', () => {
  const urls = resolveJupyterUrls(info({ baseUrl: 'https://jhub.example/user/x' }), 'https://app.example');
  assert.deepEqual(urls, { baseUrl: 'https://jhub.example/user/x', wsUrl: 'wss://jhub.example/user/x' });
});

test('resolveJupyterUrls falls back to same-origin + nbPrefix', () => {
  assert.deepEqual(resolveJupyterUrls(info({ nbPrefix: '/user/abc' }), 'https://app.example'), {
    baseUrl: 'https://app.example/user/abc',
    wsUrl: 'wss://app.example/user/abc',
  });
  // nbPrefix without leading slash and origin with trailing slash both normalize
  assert.deepEqual(resolveJupyterUrls(info({ nbPrefix: 'nb' }), 'http://localhost:3000/'), {
    baseUrl: 'http://localhost:3000/nb',
    wsUrl: 'ws://localhost:3000/nb',
  });
  // no prefix → bare origin
  assert.deepEqual(resolveJupyterUrls(info(), 'http://localhost:3000'), {
    baseUrl: 'http://localhost:3000',
    wsUrl: 'ws://localhost:3000',
  });
});

test('iopubMessageFrom extracts msg_type + content, tolerating missing fields', () => {
  assert.deepEqual(iopubMessageFrom({ header: { msg_type: 'stream' }, content: { name: 'stdout', text: 'x' } }), {
    msg_type: 'stream',
    content: { name: 'stdout', text: 'x' },
  });
  // missing content → {}
  assert.deepEqual(iopubMessageFrom({ header: { msg_type: 'clear_output' } }), { msg_type: 'clear_output', content: {} });
  // no msg_type → null
  assert.equal(iopubMessageFrom({ content: {} }), null);
  assert.equal(iopubMessageFrom({ header: {} }), null);
});

test('kernelStatusFrom reads execution_state from status messages only', () => {
  assert.equal(kernelStatusFrom({ header: { msg_type: 'status' }, content: { execution_state: 'busy' } }), 'busy');
  assert.equal(kernelStatusFrom({ header: { msg_type: 'status' }, content: { execution_state: 'idle' } }), 'idle');
  assert.equal(kernelStatusFrom({ header: { msg_type: 'status' }, content: { execution_state: 'weird' } }), 'unknown');
  // not a status message → null
  assert.equal(kernelStatusFrom({ header: { msg_type: 'stream' }, content: {} }), null);
});

test('kernelStatusLabelKey resolves the footer status key with correct precedence', () => {
  const base = { editable: true, runError: false, phase: 'ready', running: false, timedOut: false };
  // read-only viewers see nothing
  assert.equal(kernelStatusLabelKey({ ...base, editable: false }), '');
  // errors/unavailable win over everything
  assert.equal(kernelStatusLabelKey({ ...base, runError: true, running: true }), 'play.notebook.kernelUnavailable');
  assert.equal(kernelStatusLabelKey({ ...base, phase: 'unavailable' }), 'play.notebook.kernelUnavailable');
  assert.equal(kernelStatusLabelKey({ ...base, phase: 'connecting' }), 'play.notebook.kernelConnecting');
  // a run that has passed the timeout shows the "slow" hint instead of plain busy
  assert.equal(kernelStatusLabelKey({ ...base, running: true, timedOut: true }), 'play.notebook.kernelSlow');
  assert.equal(kernelStatusLabelKey({ ...base, running: true }), 'play.notebook.kernelBusy');
  assert.equal(kernelStatusLabelKey({ ...base, phase: 'busy' }), 'play.notebook.kernelBusy');
  assert.equal(kernelStatusLabelKey(base), 'play.notebook.kernelReady');
  // timeout without an active run is ignored (nothing running to be slow)
  assert.equal(kernelStatusLabelKey({ ...base, timedOut: true }), 'play.notebook.kernelReady');
  // 'disabled' (feature off) wins even over a failed run, and is distinct from unavailable
  assert.equal(kernelStatusLabelKey({ ...base, phase: 'disabled', runError: true }), 'play.notebook.kernelDisabled');
});

test('isJupyterDisabledError is true only for a 404-status error', () => {
  assert.equal(isJupyterDisabledError({ status: 404 }), true);
  assert.equal(isJupyterDisabledError({ status: 500 }), false);
  assert.equal(isJupyterDisabledError(new Error('boom')), false);
  assert.equal(isJupyterDisabledError(null), false);
  assert.equal(isJupyterDisabledError(undefined), false);
});
