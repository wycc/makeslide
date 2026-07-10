import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import {
  isValidRuntimeToken,
  namespaceForUser,
  notebookNameForRuntime,
  sanitizeDnsLabel,
} from '../src/routes/jupyter';
import { setKubeflowClientOptionsForTest, type NotebookCr } from '../src/services/kubeflowClient';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'account-1', email = `${sub}@example.com`): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email }), 'utf8').toString(
    'base64url',
  );
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function authHeaders(sub = 'account-1', email?: string) {
  return { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(sub, email))}` };
}

type ConfigPatch = Partial<
  Pick<
    typeof config,
    'jupyterEnabled' | 'jupyterMode' | 'kubeflowDefaultNamespaceTemplate' | 'kubeflowNotebookPrefix'
  >
>;

function withConfig(patch: ConfigPatch): () => void {
  const prev: ConfigPatch = {
    jupyterEnabled: config.jupyterEnabled,
    jupyterMode: config.jupyterMode,
    kubeflowDefaultNamespaceTemplate: config.kubeflowDefaultNamespaceTemplate,
    kubeflowNotebookPrefix: config.kubeflowNotebookPrefix,
  };
  Object.assign(config as Record<string, unknown>, patch);
  return () => Object.assign(config as Record<string, unknown>, prev);
}

const KUBEFLOW_CONFIG: ConfigPatch = {
  jupyterEnabled: true,
  jupyterMode: 'kubeflow',
  kubeflowDefaultNamespaceTemplate: '{user}',
  kubeflowNotebookPrefix: 'makeslide-jupyter-',
};

function notebook(overrides: Partial<NotebookCr> = {}): NotebookCr {
  return {
    metadata: { name: 'makeslide-jupyter-cpu', namespace: 'account-1' },
    status: { readyReplicas: 1 },
    ...overrides,
  };
}

/** Fake k8s API: serves Notebook CRs from an in-memory map keyed by `namespace/name`. */
function fakeK8sFetch(notebooks: Record<string, NotebookCr>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const match = /\/namespaces\/([^/]+)\/notebooks\/([^/]+)$/.exec(url);
    if (!match) return new Response(null, { status: 400 });
    const key = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`;
    const cr = notebooks[key];
    if (!cr) return new Response(null, { status: 404 });
    return new Response(JSON.stringify(cr), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function withFakeK8sApi(notebooks: Record<string, NotebookCr>): () => void {
  setKubeflowClientOptionsForTest({
    apiServerUrl: 'https://fake-k8s-api.test',
    token: 'fake-token',
    fetchImpl: fakeK8sFetch(notebooks),
  });
  return () => setKubeflowClientOptionsForTest(null);
}

test('sanitizeDnsLabel lowercases, strips unsafe chars, and never returns empty', () => {
  assert.equal(sanitizeDnsLabel('Account-1'), 'account-1');
  assert.equal(sanitizeDnsLabel('a.b_c@d'), 'a-b-c-d');
  assert.equal(sanitizeDnsLabel('---'), 'user');
  assert.equal(sanitizeDnsLabel(''), 'user');
});

test('namespaceForUser derives the namespace from the email local-part via the template', () => {
  assert.equal(namespaceForUser('alice@example.com', '{user}'), 'alice');
  assert.equal(namespaceForUser('alice@example.com', 'ns-{user}'), 'ns-alice');
  assert.equal(namespaceForUser('Alice.B@example.com', '{user}'), 'alice-b');
});

test('isValidRuntimeToken only allows DNS-label-safe strings', () => {
  assert.equal(isValidRuntimeToken('cpu'), true);
  assert.equal(isValidRuntimeToken('gpu-a100'), true);
  assert.equal(isValidRuntimeToken(''), false);
  assert.equal(isValidRuntimeToken('../etc'), false);
  assert.equal(isValidRuntimeToken('Foo_Bar'), false);
  assert.equal(isValidRuntimeToken('-leading'), false);
});

test('notebookNameForRuntime concatenates the configured prefix and runtime', () => {
  assert.equal(notebookNameForRuntime('makeslide-jupyter-', 'gpu-a100'), 'makeslide-jupyter-gpu-a100');
});

test('GET /api/jupyter/connection (kubeflow mode) 401s when unauthenticated', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection' });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
    restore();
  }
});

test('GET /api/jupyter/connection (kubeflow mode) returns same-origin notebook prefix when running', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const restoreApi = withFakeK8sApi({
    'account-1/makeslide-jupyter-cpu': notebook({ status: { readyReplicas: 1 } }),
  });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection', headers: authHeaders() });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.enabled, true);
    assert.equal(body.baseUrl, '');
    assert.equal(body.wsUrl, '');
    assert.equal(body.token, '');
    assert.equal(body.nbPrefix, '/notebook/account-1/makeslide-jupyter-cpu');
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});

test('GET /api/jupyter/connection (kubeflow mode) respects ?runtime= to pick a different notebook', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const restoreApi = withFakeK8sApi({
    'account-1/makeslide-jupyter-gpu-a100': notebook({
      metadata: { name: 'makeslide-jupyter-gpu-a100', namespace: 'account-1' },
      status: { readyReplicas: 1 },
    }),
  });
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jupyter/connection?runtime=gpu-a100',
      headers: authHeaders(),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().nbPrefix, '/notebook/account-1/makeslide-jupyter-gpu-a100');
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});

test('GET /api/jupyter/connection (kubeflow mode) rejects a runtime value with unsafe characters', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jupyter/connection?runtime=../other-namespace',
      headers: authHeaders(),
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'INVALID_RUNTIME');
  } finally {
    await app.close();
    restore();
  }
});

test('GET /api/jupyter/connection (kubeflow mode) 404s with NOTEBOOK_NOT_FOUND for a non-default runtime that doesn\'t exist', async () => {
  // A non-default runtime never triggers the phase-7c zero-config auto-create (that's cpu-only),
  // so this stays a plain 404 without touching listNotebooks/create at all.
  const restore = withConfig(KUBEFLOW_CONFIG);
  const restoreApi = withFakeK8sApi({});
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection?runtime=gpu-a100', headers: authHeaders() });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'NOTEBOOK_NOT_FOUND');
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});

test('GET /api/jupyter/connection (kubeflow mode) wakes a stopped notebook and 202s with starting:true (phase 7c)', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const restoreApi = withFakeK8sApi({
    'account-1/makeslide-jupyter-cpu': notebook({
      metadata: {
        name: 'makeslide-jupyter-cpu',
        namespace: 'account-1',
        annotations: { 'kubeflow-resource-stopped': '2026-07-10T00:00:00Z' },
      },
    }),
  });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection', headers: authHeaders() });
    assert.equal(res.statusCode, 202);
    assert.equal(res.json().starting, true);
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});

test('GET /api/jupyter/connection (kubeflow mode) 202s with starting:true while the pod is not yet ready', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const restoreApi = withFakeK8sApi({
    'account-1/makeslide-jupyter-cpu': notebook({ status: { readyReplicas: 0 } }),
  });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection', headers: authHeaders() });
    assert.equal(res.statusCode, 202);
    assert.equal(res.json().starting, true);
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});

test('GET /api/jupyter/connection (kubeflow mode) never leaks another namespace regardless of session', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const restoreApi = withFakeK8sApi({
    // Only bob's namespace has a running notebook; alice must never see it. A non-default
    // runtime keeps this on the plain 404 path (phase 7c's auto-create is cpu-only).
    'bob/makeslide-jupyter-gpu-a100': notebook({ metadata: { name: 'makeslide-jupyter-gpu-a100', namespace: 'bob' } }),
  });
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jupyter/connection?runtime=gpu-a100',
      headers: authHeaders('alice', 'alice@example.com'),
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});
