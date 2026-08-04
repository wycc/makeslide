/**
 * 啟動一份完全隔離的 MakeSlide 供 E2E 使用，並把後端 log 收下來當證據。
 *
 * 只啟動一個 process：後端在 `NODE_ENV=production` 下會以 @fastify/static 服務
 * `frontend/dist`，所以前端與 API 同源。沒有 dev proxy、沒有跨埠 cookie 問題，
 * 而且「前端做了什麼」與「後端印了什麼」天然對得起來。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { startFakeOpenAI, type FakeOpenAI } from './fakeOpenAI';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');

/** E2E 專屬的 session 簽章金鑰。與生產無關——鑄造 session 的能力只在這裡成立。 */
export const E2E_SESSION_SECRET = 'e2e-only-session-secret-do-not-use-in-production';

export interface BackendLogLine {
  ts: number;
  level: string;
  msg: string;
  raw: string;
}

export interface Stack {
  baseUrl: string;
  fakeOpenAI: FakeOpenAI;
  storageRoot: string;
  dbPath: string;
  /** 取回某個時間窗內的後端 log，用來與前端事件對齊。 */
  logsBetween(fromMs: number, toMs: number): BackendLogLine[];
  allLogs(): BackendLogLine[];
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`backend exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
      lastError = `health returned ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`backend did not become healthy within ${timeoutMs}ms (${lastError})`);
}

/** 前端要先建置，因為後端服務的是 `frontend/dist`。dist 比原始碼新就跳過。 */
async function ensureFrontendBuilt(): Promise<void> {
  const distIndex = path.join(REPO_ROOT, 'frontend', 'dist', 'index.html');
  const srcDir = path.join(REPO_ROOT, 'frontend', 'src');
  let distMtime = 0;
  try {
    distMtime = (await fs.stat(distIndex)).mtimeMs;
  } catch {
    distMtime = 0;
  }
  if (distMtime > 0) {
    let newest = 0;
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else newest = Math.max(newest, (await fs.stat(full)).mtimeMs);
      }
    };
    await walk(srcDir);
    if (distMtime > newest) return;
  }
  await execFileAsync('npm', ['--workspace', 'frontend', 'run', 'build'], {
    cwd: REPO_ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
}

export async function startStack(options: { runDir: string }): Promise<Stack> {
  await ensureFrontendBuilt();

  const fakeOpenAI = await startFakeOpenAI();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  // 每次執行都用全新的 DB 與 storage，跑 E2E 絕不會碰到開發資料。
  const dataDir = path.join(options.runDir, 'backend-data');
  const storageRoot = path.join(dataDir, 'storage');
  const dbPath = path.join(dataDir, 'e2e.db');
  await fs.mkdir(storageRoot, { recursive: true });

  const logs: BackendLogLine[] = [];
  const logFile = path.join(options.runDir, 'backend.log');
  const logHandle = await fs.open(logFile, 'a');

  const child = spawn(
    'npx',
    ['tsx', path.join(REPO_ROOT, 'backend', 'src', 'server.ts')],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DB_PATH: dbPath,
        STORAGE_ROOT: storageRoot,
        // 每帳號設定也要隔離，否則跑一次 E2E 就在開發者的 accounts/ 留下測試帳號。
        ACCOUNTS_DIR: path.join(dataDir, 'accounts'),
        AUTH_SESSION_SECRET: E2E_SESSION_SECRET,
        // 後端啟動時會載入 repo 的 .env，裡面是開發者的真實金鑰。dotenv 不覆寫已存在的
        // 環境變數，所以在這裡先把每一把都設成測試值——測試不該有能力真的打到外部服務，
        // 也不該把真實金鑰寫進 artifacts 裡的證據檔。
        GEMINI_API_KEY: 'e2e-fake-key',
        GERMINI_API_KEY: 'e2e-fake-key',
        CGU_AIR_API_KEY: 'e2e-fake-key',
        OPENROUTER_API_KEY: 'e2e-fake-key',
        // 假 LLM：所有生成流程都指到它，不燒錢也不會有不確定輸出。
        OPENAI_BASE_URL: fakeOpenAI.baseUrl,
        OPENAI_API_KEY: 'e2e-fake-key',
        LLM_PROVIDER: 'openai',
        TTS_PROVIDER: 'openai',
        // Google OAuth 不啟用 → 後端不強制登入，測試自行決定何時注入 session。
        GOOGLE_AUTH_ENABLED: 'false',
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
        LOG_LEVEL: 'debug',
        SUPPRESS_POLLING_REQUEST_LOGS: 'true',
        JUPYTER_ENABLED: 'false',
        PROCESS_CONCURRENCY: '2',
        // 出圖與 TTS 在假伺服器上很快，縮短逾時讓卡住的測試快點失敗而不是慢慢等。
        OPENAI_IMAGE_TIMEOUT_MS: '20000',
        OPENAI_REQUEST_TIMEOUT_MS: '20000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  // 後端在收到 SIGTERM 後仍可能吐出最後幾行；此時 log 檔已經關了，再寫會 EBADF。
  let logFileOpen = true;
  const consume = (stream: NodeJS.ReadableStream): void => {
    let buffer = '';
    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const raw of lines) {
        if (!raw.trim()) continue;
        if (logFileOpen) void logHandle.write(`${raw}\n`).catch(() => { logFileOpen = false; });
        logs.push(parseLogLine(raw));
      }
    });
  };
  consume(child.stdout!);
  consume(child.stderr!);

  try {
    await waitForHealth(baseUrl, 90_000, child);
  } catch (err) {
    child.kill('SIGKILL');
    await fakeOpenAI.close();
    const tail = logs.slice(-40).map((l) => l.raw).join('\n');
    throw new Error(`${(err as Error).message}\n--- backend log tail ---\n${tail}`);
  }

  return {
    baseUrl,
    fakeOpenAI,
    storageRoot,
    dbPath,
    logsBetween: (fromMs, toMs) => logs.filter((l) => l.ts >= fromMs && l.ts <= toMs),
    allLogs: () => [...logs],
    async stop() {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5_000);
        child.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      logFileOpen = false;
      await logHandle.close();
      await fakeOpenAI.close();
    },
  };
}

/** pino 在 production 下輸出 JSON lines；非 JSON 的行（例如 npm 的雜訊）原樣保留。 */
function parseLogLine(raw: string): BackendLogLine {
  try {
    const parsed = JSON.parse(raw) as { time?: number; level?: number; msg?: string };
    if (typeof parsed.time === 'number') {
      return {
        ts: parsed.time,
        level: levelName(parsed.level),
        msg: parsed.msg ?? '',
        raw,
      };
    }
  } catch {
    // 不是 JSON，往下當純文字處理。
  }
  return { ts: Date.now(), level: 'raw', msg: raw, raw };
}

function levelName(level: number | undefined): string {
  if (level === undefined) return 'info';
  if (level >= 60) return 'fatal';
  if (level >= 50) return 'error';
  if (level >= 40) return 'warn';
  if (level >= 30) return 'info';
  if (level >= 20) return 'debug';
  return 'trace';
}
