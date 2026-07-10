import { ApiError, parseErrorBody } from './common';
import type { JupyterConnectionInfo } from '../jupyterConnection';

export type { JupyterConnectionInfo };

/**
 * Fetch Jupyter connection parameters (session-protected). Throws when the feature is
 * disabled (404), the request is unauthenticated (401), or the Kubeflow notebook Pod is still
 * booting (202 — check with `isJupyterStartingError` and poll, see docs/jupyter-kubeflow-plan.md
 * §3.2/§3.5); resolve the returned info with `resolveJupyterUrls` before handing it to
 * @jupyterlab/services. `runtime` selects which Kubeflow notebook to connect to (§3.4); ignored
 * in the single-server modes.
 */
export async function fetchJupyterConnection(runtime?: string): Promise<JupyterConnectionInfo> {
  const url = runtime ? `/api/jupyter/connection?runtime=${encodeURIComponent(runtime)}` : '/api/jupyter/connection';
  const resp = await fetch(url);
  // 202 is a 2xx ("ok") status but its body is `{starting:true}`, not connection info — surface
  // it as a distinct, typed error rather than returning a bogus JupyterConnectionInfo.
  if (resp.status === 202) throw new ApiError('Kubeflow notebook is starting', 'STARTING', 202);
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as JupyterConnectionInfo;
}

/** One `makeslide-jupyter-<runtime>` notebook available to the caller in kubeflow mode (§3.4). */
export interface JupyterRuntimeInfo {
  runtime: string;
  status: 'running' | 'pending' | 'stopped';
  gpu: boolean;
  image: string | null;
}

/**
 * List the caller's own Kubeflow runtimes. Resolves to `[]` when the feature is disabled/not
 * in kubeflow mode (404) or unauthenticated, so callers can treat an empty list as "no picker
 * needed" without a separate error branch.
 */
export async function fetchJupyterRuntimes(): Promise<JupyterRuntimeInfo[]> {
  const resp = await fetch('/api/jupyter/runtimes');
  if (!resp.ok) return [];
  const body = (await resp.json()) as { runtimes: JupyterRuntimeInfo[] };
  return body.runtimes;
}
