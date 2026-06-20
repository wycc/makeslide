import { spawn } from 'node:child_process';

const UNZIP_IMPORT_TIMEOUT_MS = 2 * 60_000;

/** Exported for unit testing; not part of the public import routes API. */
export function runUnzipCommand(
  zipPath: string,
  outputDir: string,
  options: { command?: string; timeoutMs?: number } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = options.command ?? 'unzip';
    const timeoutMs = options.timeoutMs ?? UNZIP_IMPORT_TIMEOUT_MS;
    const child = spawn(command, ['-q', zipPath, '-d', outputDir], { stdio: 'ignore' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`unzip command timed out after ${timeoutMs} ms`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`unzip command failed with code ${code ?? -1}`));
    });
  });
}
