import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setKubeflowClientOptionsForTest, type NotebookCr } from '../src/services/kubeflowClient';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'account-1', email = `${sub}@example.com`): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function authHeaders(sub = 'account-1', email?: string) {
  return { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(sub, email))}` };
}

type ConfigPatch = Partial<
  Pick<
    typeof config,
    | 'jupyterEnabled'
    | 'jupyterMode'
    | 'kubeflowDefaultNamespaceTemplate'
    | 'kubeflowNotebookPrefix'
    | 'kubeflowDefaultRuntimeImage'
    | 'kubeflowDefaultRuntimeResources'
  >
>;

function withConfig(patch: ConfigPatch): () => void {
  const prev: ConfigPatch = {
    jupyterEnabled: config.jupyterEnabled,
    jupyterMode: config.jupyterMode,
    kubeflowDefaultNamespaceTemplate: config.kubeflowDefaultNamespaceTemplate,
    kubeflowNotebookPrefix: config.kubeflowNotebookPrefix,
    kubeflowDefaultRuntimeImage: config.kubeflowDefaultRuntimeImage,
    kubeflowDefaultRuntimeResources: config.kubeflowDefaultRuntimeResources,
  };
  Object.assign(config as Record<string, unknown>, patch);
  return () => Object.assign(config as Record<string, unknown>, prev);
}

const KUBEFLOW_CONFIG: ConfigPatch = {
  jupyterEnabled: true,
  jupyterMode: 'kubeflow',
  kubeflowDefaultNamespaceTemplate: '{user}',
  kubeflowNotebookPrefix: 'makeslide-jupyter-',
  kubeflowDefaultRuntimeImage: 'jupyter/base:latest',
  kubeflowDefaultRuntimeResources: 'cpu=1,memory=2Gi',
};

function notebook(name: string, overrides: Partial<NotebookCr> = {}): NotebookCr {
  return {
    metadata: { name, namespace: 'account-1' },
    status: { readyReplicas: 1 },
    ...overrides,
  };
}

interface FakeApiCall {
  method: string;
  url: string;
  body?: unknown;
}

/**
 * Stateful fake k8s API: serves/mutates an in-memory `namespace/name` map, and records every
 * call so tests can assert on the PATCH/POST payloads (not just the resulting HTTP status).
 */
function fakeK8sFetch(store: Record<string, NotebookCr>, calls: FakeApiCall[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body });

    const singleMatch = /\/namespaces\/([^/]+)\/notebooks\/([^/]+)$/.exec(url);
    const listMatch = /\/namespaces\/([^/]+)\/notebooks$/.exec(url);

    if (method === 'PATCH' && singleMatch) {
      const key = `${decodeURIComponent(singleMatch[1])}/${decodeURIComponent(singleMatch[2])}`;
      const existing = store[key];
      if (!existing) return new Response(null, { status: 404 });
      const patchAnnotations = (body?.metadata?.annotations ?? {}) as Record<string, string | null>;
      const nextAnnotations = { ...existing.metadata.annotations };
      for (const [k, v] of Object.entries(patchAnnotations)) {
        if (v === null) delete nextAnnotations[k];
        else nextAnnotations[k] = v;
      }
      store[key] = { ...existing, metadata: { ...existing.metadata, annotations: nextAnnotations } };
      return new Response(JSON.stringify(store[key]), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (method === 'POST' && listMatch) {
      const namespace = decodeURIComponent(listMatch[1]);
      const key = `${namespace}/${body.metadata.name}`;
      if (store[key]) return new Response(null, { status: 409 });
      store[key] = body as NotebookCr;
      return new Response(JSON.stringify(store[key]), { status: 201, headers: { 'content-type': 'application/json' } });
    }

    if (method === 'GET' && singleMatch) {
      const key = `${decodeURIComponent(singleMatch[1])}/${decodeURIComponent(singleMatch[2])}`;
      const cr = store[key];
      if (!cr) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(cr), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (method === 'GET' && listMatch) {
      const namespace = decodeURIComponent(listMatch[1]);
      const items = Object.entries(store)
        .filter(([key]) => key.startsWith(`${namespace}/`))
        .map(([, cr]) => cr);
      return new Response(JSON.stringify({ items }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    return new Response(null, { status: 400 });
  }) as typeof fetch;
}

function withFakeK8sApi(store: Record<string, NotebookCr>): { restore: () => void; calls: FakeApiCall[] } {
  const calls: FakeApiCall[] = [];
  setKubeflowClientOptionsForTest({
    apiServerUrl: 'https://fake-k8s-api.test',
    token: 'fake-token',
    fetchImpl: fakeK8sFetch(store, calls),
  });
  return { restore: () => setKubeflowClientOptionsForTest(null), calls };
}

test('GET /api/jupyter/connection wakes a stopped notebook (removes annotation) and returns 202 starting', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const store: Record<string, NotebookCr> = {
    'account-1/makeslide-jupyter-cpu': notebook('makeslide-jupyter-cpu', {
      status: { readyReplicas: 0 },
      metadata: { name: 'makeslide-jupyter-cpu', namespace: 'account-1', annotations: { 'kubeflow-resource-stopped': '2026-07-10T00:00:00Z' } },
    }),
  };
  const { restore: restoreApi, calls } = withFakeK8sApi(store);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection', headers: authHeaders() });
    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.json(), { starting: true });
    const patchCall = calls.find((c) => c.method === 'PATCH');
    assert.ok(patchCall, 'expected a PATCH call to wake the notebook');
    assert.deepEqual(patchCall?.body, { metadata: { annotations: { 'kubeflow-resource-stopped': null } } });
    // The fake API applied the patch — the annotation should now be gone.
    assert.equal(store['account-1/makeslide-jupyter-cpu'].metadata.annotations?.['kubeflow-resource-stopped'], undefined);
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});

test('GET /api/jupyter/connection auto-creates makeslide-jupyter-cpu when the caller has zero runtimes', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const store: Record<string, NotebookCr> = {};
  const { restore: restoreApi, calls } = withFakeK8sApi(store);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection', headers: authHeaders() });
    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.json(), { starting: true });
    const postCall = calls.find((c) => c.method === 'POST');
    assert.ok(postCall, 'expected a POST call to create the default notebook');
    const manifest = postCall?.body as NotebookCr;
    assert.equal(manifest.metadata.name, 'makeslide-jupyter-cpu');
    assert.equal(manifest.metadata.namespace, 'account-1');
    assert.equal(manifest.spec?.template?.spec?.containers?.[0]?.image, 'jupyter/base:latest');
    assert.deepEqual(manifest.spec?.template?.spec?.containers?.[0]?.resources?.limits, { cpu: '1', memory: '2Gi' });
    assert.ok(store['account-1/makeslide-jupyter-cpu'], 'the fake store should now have the created notebook');
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});

test('GET /api/jupyter/connection does not auto-create when the caller already has a different runtime', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const store: Record<string, NotebookCr> = {
    'account-1/makeslide-jupyter-gpu-a100': notebook('makeslide-jupyter-gpu-a100'),
  };
  const { restore: restoreApi, calls } = withFakeK8sApi(store);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection', headers: authHeaders() });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'NOTEBOOK_NOT_FOUND');
    assert.equal(calls.some((c) => c.method === 'POST'), false, 'must not auto-create when another runtime already exists');
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});

test('GET /api/jupyter/connection does not auto-create for an explicitly-requested non-default runtime', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const store: Record<string, NotebookCr> = {};
  const { restore: restoreApi, calls } = withFakeK8sApi(store);
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jupyter/connection?runtime=gpu-a100',
      headers: authHeaders(),
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'NOTEBOOK_NOT_FOUND');
    assert.equal(calls.some((c) => c.method === 'POST'), false, 'must never auto-create a GPU/custom runtime');
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});

test('GET /api/jupyter/connection treats a 409 AlreadyExists race on auto-create as success', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  // Simulate two tabs racing: the notebook already exists by the time create is attempted, but
  // listNotebooks() (called first) still saw zero runtimes.
  const calls: FakeApiCall[] = [];
  const racyFetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    const singleMatch = /\/namespaces\/([^/]+)\/notebooks\/([^/]+)$/.exec(url);
    const listMatch = /\/namespaces\/([^/]+)\/notebooks$/.exec(url);
    if (method === 'GET' && singleMatch) {
      return new Response(null, { status: 404 }); // getNotebook(namespace, 'makeslide-jupyter-cpu') — not found yet
    }
    if (method === 'GET' && listMatch) {
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (method === 'POST' && listMatch) {
      return new Response(null, { status: 409 }); // AlreadyExists — another tab won the race
    }
    return new Response(null, { status: 400 });
  }) as typeof fetch;
  setKubeflowClientOptionsForTest({ apiServerUrl: 'https://fake-k8s-api.test', token: 'fake-token', fetchImpl: racyFetch });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/connection', headers: authHeaders() });
    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.json(), { starting: true });
  } finally {
    await app.close();
    restore();
    setKubeflowClientOptionsForTest(null);
  }
});
