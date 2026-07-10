import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { runtimeFromNotebookName } from '../src/routes/jupyter';
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
  Pick<typeof config, 'jupyterEnabled' | 'jupyterMode' | 'kubeflowDefaultNamespaceTemplate' | 'kubeflowNotebookPrefix'>
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

function notebook(name: string, overrides: Partial<NotebookCr> = {}): NotebookCr {
  return {
    metadata: { name, namespace: 'account-1' },
    status: { readyReplicas: 1 },
    ...overrides,
  };
}

/** Fake k8s API: serves a namespace's Notebook CR list from an in-memory map keyed by namespace. */
function fakeK8sFetch(byNamespace: Record<string, NotebookCr[]>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const match = /\/namespaces\/([^/]+)\/notebooks$/.exec(url);
    if (!match) return new Response(null, { status: 400 });
    const namespace = decodeURIComponent(match[1]);
    return new Response(JSON.stringify({ items: byNamespace[namespace] ?? [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function withFakeK8sApi(byNamespace: Record<string, NotebookCr[]>): () => void {
  setKubeflowClientOptionsForTest({
    apiServerUrl: 'https://fake-k8s-api.test',
    token: 'fake-token',
    fetchImpl: fakeK8sFetch(byNamespace),
  });
  return () => setKubeflowClientOptionsForTest(null);
}

test('runtimeFromNotebookName strips the configured prefix, or returns null when absent', () => {
  assert.equal(runtimeFromNotebookName('makeslide-jupyter-', 'makeslide-jupyter-gpu-a100'), 'gpu-a100');
  assert.equal(runtimeFromNotebookName('makeslide-jupyter-', 'makeslide-jupyter-cpu'), 'cpu');
  assert.equal(runtimeFromNotebookName('makeslide-jupyter-', 'some-other-notebook'), null);
});

test('GET /api/jupyter/runtimes 404s when not in kubeflow mode', async () => {
  const restore = withConfig({ jupyterEnabled: true, jupyterMode: 'proxy' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/runtimes', headers: authHeaders() });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
    restore();
  }
});

test('GET /api/jupyter/runtimes 401s when unauthenticated', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/runtimes' });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
    restore();
  }
});

test('GET /api/jupyter/runtimes lists only prefix-matching notebooks, with status/gpu/image', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const restoreApi = withFakeK8sApi({
    'account-1': [
      notebook('makeslide-jupyter-cpu', { status: { readyReplicas: 1 } }),
      notebook('makeslide-jupyter-gpu-a100', {
        status: { readyReplicas: 0 },
        spec: {
          template: {
            spec: {
              containers: [{ image: 'my-gpu-image:latest', resources: { limits: { 'nvidia.com/gpu': '1' } } }],
            },
          },
        },
      }),
      notebook('some-other-notebook'), // not matching the prefix — must not appear
    ],
  });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/jupyter/runtimes', headers: authHeaders() });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { runtimes: Array<{ runtime: string; status: string; gpu: boolean; image: string | null }> };
    assert.equal(body.runtimes.length, 2);
    const cpu = body.runtimes.find((r) => r.runtime === 'cpu');
    assert.deepEqual(cpu, { runtime: 'cpu', status: 'running', gpu: false, image: null });
    const gpu = body.runtimes.find((r) => r.runtime === 'gpu-a100');
    assert.deepEqual(gpu, { runtime: 'gpu-a100', status: 'pending', gpu: true, image: 'my-gpu-image:latest' });
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});

test('GET /api/jupyter/runtimes only ever lists the caller\'s own namespace', async () => {
  const restore = withConfig(KUBEFLOW_CONFIG);
  const restoreApi = withFakeK8sApi({
    bob: [notebook('makeslide-jupyter-cpu', { metadata: { name: 'makeslide-jupyter-cpu', namespace: 'bob' } })],
  });
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jupyter/runtimes',
      headers: authHeaders('alice', 'alice@example.com'),
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { runtimes: [] });
  } finally {
    await app.close();
    restore();
    restoreApi();
  }
});
