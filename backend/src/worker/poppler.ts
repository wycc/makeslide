import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from '../config';

export interface PopplerCheck {
  pdftoppm: boolean;
  pdfinfo: boolean;
  versionOutput: string;
}

function resolveBin(name: string): string {
  if (config.popplerBinPath) {
    return path.join(config.popplerBinPath, name);
  }
  return name;
}

export function pdftoppmBin(): string {
  return resolveBin('pdftoppm');
}

export function pdfinfoBin(): string {
  return resolveBin('pdfinfo');
}

export function pdftotextBin(): string {
  return resolveBin('pdftotext');
}

/**
 * Spawn a command and buffer stdout / stderr. Rejects on non-zero exit.
 */
export function runCommand(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd });
    let stdout = '';
    let stderr = '';
    let timeoutHandle: NodeJS.Timeout | null = null;
    let killed = false;

    if (options.timeoutMs) {
      timeoutHandle = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, options.timeoutMs);
    }

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err);
    });
    child.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killed) {
        reject(new Error(`${cmd} killed after timeout`));
        return;
      }
      if (code !== 0) {
        const err = new Error(
          `${cmd} exited with code ${code}: ${stderr.trim() || stdout.trim()}`,
        );
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function checkPoppler(): Promise<PopplerCheck> {
  const check: PopplerCheck = {
    pdftoppm: false,
    pdfinfo: false,
    versionOutput: '',
  };
  try {
    // pdftoppm -v writes to stderr and exits 0 on most versions, non-zero on some.
    // We treat "no error spawning" as success.
    const r1 = await runCommand(pdftoppmBin(), ['-v'], { timeoutMs: 5000 }).catch(
      (err) => ({ stdout: '', stderr: String(err) }),
    );
    check.pdftoppm = !/ENOENT/.test(r1.stderr);
    check.versionOutput += r1.stderr || r1.stdout;
  } catch {
    check.pdftoppm = false;
  }
  try {
    const r2 = await runCommand(pdfinfoBin(), ['-v'], { timeoutMs: 5000 }).catch(
      (err) => ({ stdout: '', stderr: String(err) }),
    );
    check.pdfinfo = !/ENOENT/.test(r2.stderr);
    check.versionOutput += '\n' + (r2.stderr || r2.stdout);
  } catch {
    check.pdfinfo = false;
  }
  return check;
}

export async function extractPdfText(sourcePath: string): Promise<string> {
  const { stdout } = await runCommand(
    pdftotextBin(),
    ['-layout', '-enc', 'UTF-8', sourcePath, '-'],
    { timeoutMs: 120000 },
  );
  return stdout.replace(/\u0000/g, '').trim();
}

/**
 * Parse `Pages: NN` from pdfinfo output.
 */
export async function getPdfPageCount(sourcePath: string): Promise<number> {
  const { stdout } = await runCommand(
    pdfinfoBin(),
    [sourcePath],
    { timeoutMs: 30000 },
  );
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) {
    throw new Error(`Cannot parse page count from pdfinfo output:\n${stdout}`);
  }
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid page count: ${match[1]}`);
  }
  return n;
}
