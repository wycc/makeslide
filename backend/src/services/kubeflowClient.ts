import fs from 'node:fs';

/**
 * Minimal REST client for the Kubeflow Notebook custom resource
 * (`notebooks.kubeflow.org/v1`), used by the `JUPYTER_MODE=kubeflow` connection
 * flow (docs/jupyter-kubeflow-plan.md §3.2/§3.3). Deliberately thin — MakeSlide
 * only ever needs get/list/patch/create on this one resource, so a hand-rolled
 * client keeps the dependency footprint small and every call injectable with a
 * fake `fetchImpl` for tests (no cluster required).
 *
 * In-cluster trust: the k8s API server's CA is not in the default trust store.
 * Rather than hand-roll a custom TLS dispatcher here, operators should set
 * `NODE_EXTRA_CA_CERTS=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`
 * (documented in phase 7e's deployment notes), which Node's built-in `fetch`
 * honors natively.
 */

const SERVICE_ACCOUNT_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';

export interface KubeflowClientOptions {
  /** Override for tests / non-default clusters. Defaults to the in-cluster API server. */
  apiServerUrl?: string;
  /** Override for tests. Defaults to the mounted ServiceAccount token. */
  token?: string;
  /** Override the HTTP client (fake k8s API for tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface NotebookCr {
  metadata: {
    name: string;
    namespace: string;
    annotations?: Record<string, string>;
  };
  status?: {
    readyReplicas?: number;
  };
  spec?: {
    template?: {
      spec?: {
        containers?: Array<{
          image?: string;
          resources?: {
            limits?: Record<string, string>;
          };
        }>;
      };
    };
  };
}

interface NotebookCrList {
  items?: NotebookCr[];
}

export type NotebookState = 'running' | 'pending' | 'stopped' | 'not_found';

/** Annotation the Kubeflow notebook-controller uses to mark a culled/stopped notebook. */
export const NOTEBOOK_STOPPED_ANNOTATION = 'kubeflow-resource-stopped';

function inClusterApiServerUrl(): string {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  if (!host) return '';
  const port = process.env.KUBERNETES_SERVICE_PORT ?? '443';
  return `https://${host}:${port}`;
}

function readServiceAccountToken(): string {
  try {
    return fs.readFileSync(`${SERVICE_ACCOUNT_DIR}/token`, 'utf8').trim();
  } catch {
    return '';
  }
}

interface ResolvedOptions {
  apiServerUrl: string;
  token: string;
  fetchImpl: typeof fetch;
}

// Route handlers call getNotebook() with no per-call options (the caller only knows
// namespace/name); tests instead swap in a fake k8s API here once per test, mirroring
// the setXForTest pattern used elsewhere (e.g. services/openai.ts's setOpenAIClientForTest).
let testOverride: KubeflowClientOptions | null = null;

export function setKubeflowClientOptionsForTest(opts: KubeflowClientOptions | null): void {
  testOverride = opts;
}

function resolveOptions(opts: KubeflowClientOptions): ResolvedOptions {
  const merged: KubeflowClientOptions = { ...testOverride, ...opts };
  return {
    apiServerUrl: merged.apiServerUrl ?? inClusterApiServerUrl(),
    token: merged.token ?? readServiceAccountToken(),
    fetchImpl: merged.fetchImpl ?? fetch,
  };
}

function notebooksCollectionUrl(apiServerUrl: string, namespace: string): string {
  return `${apiServerUrl}/apis/kubeflow.org/v1/namespaces/${encodeURIComponent(namespace)}/notebooks`;
}

function notebookUrl(apiServerUrl: string, namespace: string, name: string): string {
  return `${notebooksCollectionUrl(apiServerUrl, namespace)}/${encodeURIComponent(name)}`;
}

/** Fetch one Notebook CR, or `null` if it doesn't exist (404). Throws on any other API error. */
export async function getNotebook(
  namespace: string,
  name: string,
  opts: KubeflowClientOptions = {},
): Promise<NotebookCr | null> {
  const { apiServerUrl, token, fetchImpl } = resolveOptions(opts);
  if (!apiServerUrl) {
    throw new Error('Kubernetes API server not configured (not running in-cluster and no apiServerUrl override)');
  }
  const res = await fetchImpl(notebookUrl(apiServerUrl, namespace, name), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Kubeflow API error fetching notebook ${namespace}/${name}: ${res.status}`);
  }
  return (await res.json()) as NotebookCr;
}

/** Derive the connection-relevant state of a Notebook CR (§3.2). */
export function notebookState(cr: NotebookCr | null): NotebookState {
  if (!cr) return 'not_found';
  if (cr.metadata.annotations?.[NOTEBOOK_STOPPED_ANNOTATION] != null) return 'stopped';
  return (cr.status?.readyReplicas ?? 0) >= 1 ? 'running' : 'pending';
}

/** List every Notebook CR in a namespace (used by runtime discovery, §3.4). */
export async function listNotebooks(namespace: string, opts: KubeflowClientOptions = {}): Promise<NotebookCr[]> {
  const { apiServerUrl, token, fetchImpl } = resolveOptions(opts);
  if (!apiServerUrl) {
    throw new Error('Kubernetes API server not configured (not running in-cluster and no apiServerUrl override)');
  }
  const res = await fetchImpl(notebooksCollectionUrl(apiServerUrl, namespace), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`Kubeflow API error listing notebooks in ${namespace}: ${res.status}`);
  }
  const list = (await res.json()) as NotebookCrList;
  return list.items ?? [];
}

/** First container's image, if declared (§3.4 runtime discovery). */
export function notebookImage(cr: NotebookCr): string | null {
  return cr.spec?.template?.spec?.containers?.[0]?.image ?? null;
}

/**
 * Whether any container requests a GPU device-plugin resource (e.g. `nvidia.com/gpu`,
 * `amd.com/gpu`). Used to badge a runtime as GPU-backed in the discovery list (§3.4) —
 * MakeSlide never interprets *which* GPU/how much, just whether one was requested.
 */
export function notebookHasGpu(cr: NotebookCr): boolean {
  const containers = cr.spec?.template?.spec?.containers ?? [];
  return containers.some((c) =>
    Object.keys(c.resources?.limits ?? {}).some((key) => /\.com\/gpu$/.test(key)),
  );
}
