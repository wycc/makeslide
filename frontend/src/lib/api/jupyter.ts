import { parseErrorBody } from './common';
import type { JupyterConnectionInfo } from '../jupyterConnection';

export type { JupyterConnectionInfo };

/**
 * Fetch Jupyter connection parameters (session-protected). Throws when the feature is
 * disabled (404) or the request is unauthenticated (401); resolve the returned info with
 * `resolveJupyterUrls` before handing it to @jupyterlab/services.
 */
export async function fetchJupyterConnection(): Promise<JupyterConnectionInfo> {
  const resp = await fetch('/api/jupyter/connection');
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as JupyterConnectionInfo;
}
