import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "./config";
import { logger } from "./logger";
import { decodeSession, encodeSession, parseCookies, SESSION_COOKIE } from "./routes/auth";
import { findAccountIdByMcpAuthToken, getSystemAuthSettings } from "./services/aiSettings";
import { accountIdFromOwnerSub, runWithAccountId } from "./services/accountContext";
import { db } from "./db";
import { ensureStorageRoot } from "./services/storage";
import { cacheControlForStaticAsset } from "./staticCache";
import { isApiKeyMissingError } from "./services/apiKeyErrors";

/**
 * 解析這個請求應該在哪個帳號的情境中執行：
 * - 路徑帶有簡報 id（/api/pdfs/:id/...）時，一律採用該簡報擁有者的帳號 ——
 *   這樣不管是誰觸發處理（含 public_editable 簡報的協作者），都會用「這份
 *   簡報所屬帳號」的 AI 設定與金鑰，行為可預期、不會把協作者的金鑰用到別人
 *   的簡報上。
 * - 否則（例如帳號設定頁、建立新簡報）採用登入者自己的帳號。
 */
function resolveAccountIdForRequest(request: FastifyRequest): string {
  const params = request.params as Record<string, unknown> | undefined;
  const pdfId = typeof params?.id === 'string' ? params.id : null;
  if (pdfId) {
    const row = db.prepare(`SELECT owner_sub FROM pdfs WHERE id = ?`).get(pdfId) as { owner_sub: string | null } | undefined;
    if (row) return accountIdFromOwnerSub(row.owner_sub);
  }
  const session = decodeSession(parseCookies(request)[SESSION_COOKIE]);
  return accountIdFromOwnerSub(session?.sub ?? null);
}

function shouldSuppressRequestLog(url: string | undefined): boolean {
  if (!config.suppressPollingRequestLogs || !url) return false;
  const pathOnly = url.split("?")[0] ?? url;
  return config.pollingRequestLogPaths.some((pathPrefix) => pathOnly.startsWith(pathPrefix));
}

function ensureWorkspaceRuntimePaths(): void {
  const dbDir = path.dirname(config.dbPath);
  const storageDir = config.storageRoot;
  try {
    fs.mkdirSync(dbDir, { recursive: true });
  } catch {
    // ignore mkdir failure
  }
  try {
    fs.mkdirSync(storageDir, { recursive: true });
  } catch {
    // ignore mkdir failure
  }
}

/** Constant-time string equality (avoids a JS `===` timing side-channel for secret comparisons like the MCP bearer token). Exported for unit testing. */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isApiAuthExemptPath(pathname: string): boolean {
  return pathname === '/api/health'
    || pathname.startsWith('/api/auth/')
    || pathname.startsWith('/api/share/')
    || /^\/api\/pdfs\/[^/]+\/sync\/share-join$/.test(pathname);
}

function shareTokenFromRequest(request: FastifyRequest): string | null {
  const rawHeader = request.headers['x-makeslide-share-token'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  const query = request.query as Record<string, unknown> | undefined;
  const rawQuery = query?.share;
  const queryValue = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;
  return typeof queryValue === 'string' && queryValue.trim() ? queryValue.trim() : null;
}

function isShareTokenAuthorizedForRequest(request: FastifyRequest, pathname: string): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const match = pathname.match(/^\/api\/pdfs\/([^/]+)(?:\/.*)?$/);
  const pdfId = match?.[1] ? decodeURIComponent(match[1]) : null;
  const token = shareTokenFromRequest(request);
  if (!pdfId || !token || !/^[A-Za-z0-9_-]{12,128}$/.test(token)) return false;
  const row = db
    .prepare(`SELECT token FROM pdf_shares WHERE token = ? AND pdf_id = ?`)
    .get(token, pdfId) as { token: string } | undefined;
  return Boolean(row);
}

function stripNbPrefix(pathname: string): string {
  if (!config.nbPrefix) return pathname;
  if (pathname === config.nbPrefix) return '/';
  if (pathname.startsWith(`${config.nbPrefix}/`)) {
    return pathname.slice(config.nbPrefix.length);
  }
  return pathname;
}

export async function buildApp() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(__dirname, "..", "..", "frontend", "dist");
  const httpsOptions = config.httpsKeyPath && config.httpsCertPath
    ? {
        key: fs.readFileSync(path.resolve(config.repoRoot, config.httpsKeyPath)),
        cert: fs.readFileSync(path.resolve(config.repoRoot, config.httpsCertPath)),
      }
    : undefined;
  const fastifyOptions = {
    logger,
    disableRequestLogging: config.suppressPollingRequestLogs,
    bodyLimit: config.maxUploadBytes + 1024 * 1024, // small slack for headers
    ...(httpsOptions ? { https: httpsOptions } : {}),
  };
  const app = Fastify(fastifyOptions);
  const nbPrefix = config.nbPrefix;
  const withNbPrefix = (route: string): string =>
    nbPrefix ? `${nbPrefix}${route}` : route;
  const routePrefixes = nbPrefix ? [undefined, nbPrefix] : [undefined];

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
    },
  });

  if (config.suppressPollingRequestLogs) {
    app.addHook("onRequest", async (request) => {
      if (shouldSuppressRequestLog(request.raw.url)) return;
      request.log.info({ req: request }, "incoming request");
    });

    app.addHook("onResponse", async (request, reply) => {
      if (shouldSuppressRequestLog(request.raw.url)) return;
      request.log.info(
        { res: reply, responseTime: reply.elapsedTime },
        "request completed",
      );
    });
  }

  // MCP 請求帶 Authorization: Bearer <token>，沒有瀏覽器 session cookie。每個帳號
  // 各自有自己的 MCP auth token；比對到屬於哪個帳號後，合成一份等同於該帳號正常
  // 登入時會拿到的 session cookie 並接到請求的 cookie header 上——這樣下游所有
  // 既有的 sessionSub()/canReadPdf()/canEditPdf() 邏輯（散落在各個路由檔案裡，各自
  // 從 cookie 解析 session）完全不需要修改，就會自然把這個請求當成該帳號本人發出。
  // 必須放在最前面，搶在下面解析「目前帳號」與驗證登入狀態的 hook 之前執行。
  app.addHook('onRequest', (request, _reply, done) => {
    const authHeader = request.headers.authorization ?? '';
    const bearerMatch = /^Bearer\s+(.+)$/.exec(authHeader);
    if (bearerMatch && !parseCookies(request)[SESSION_COOKIE]) {
      const accountId = findAccountIdByMcpAuthToken(bearerMatch[1] ?? '');
      if (accountId) {
        const session = { provider: 'google' as const, sub: accountId, email: `${accountId}@mcp.local` };
        const cookieValue = `${SESSION_COOKIE}=${encodeURIComponent(encodeSession(session))}`;
        request.headers.cookie = request.headers.cookie ? `${request.headers.cookie}; ${cookieValue}` : cookieValue;
      }
    }
    done();
  });

  // 多帳號設計：在進入路由與其餘 hook 之前，先依請求解析出「目前帳號」並
  // 建立 AsyncLocalStorage 情境。之後整條請求鏈（含 getRuntimeAiSettings()／
  // getOpenAIClient() 等呼叫，無論在路由處理常式或更深的服務層）都會自動
  // 取得正確且互不混用的帳號設定。
  app.addHook('onRequest', (request, _reply, done) => {
    const accountId = resolveAccountIdForRequest(request);
    runWithAccountId(accountId, () => done());
  });

  app.addHook('onRequest', async (request, reply) => {
    const runtime = getSystemAuthSettings();
    const googleAuthActive = Boolean(
      runtime.googleAuthEnabled
      && runtime.googleClientId
      && runtime.googleClientSecret,
    );
    if (!googleAuthActive) return;

    const url = request.raw.url ?? '';
    const pathname = url.split('?')[0] ?? url;
    const normalizedPath = stripNbPrefix(pathname);
    if (isApiAuthExemptPath(normalizedPath)) return;
    if (isShareTokenAuthorizedForRequest(request, normalizedPath)) return;

    // 僅保護 API；前端靜態資源與頁面路由不在此攔截。
    if (!normalizedPath.startsWith('/api/')) return;

    // 上面的 hook 若已經把 MCP bearer token 解析成某個帳號的合成 session cookie，
    // 這裡就會自然命中下面的 session 檢查，不需要再額外處理 Authorization header。
    const session = decodeSession(parseCookies(request).makeslide_session);
    if (session) return;

    return reply.code(401).send({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Google 登入已啟用，請先登入。',
      },
    });
  });

  app.get('/api/health', async () => ({ ok: true }));
  if (nbPrefix) {
    app.get(withNbPrefix('/api/health'), async () => ({ ok: true }));
  }

  app.get('/', async (_request, reply) => {
    if (nbPrefix) {
      return reply.redirect(302, `${nbPrefix}/`);
    }
    return reply.redirect(302, '/index.html');
  });

  if (nbPrefix) {
    app.get(`${nbPrefix}/`, async (_request, reply) => {
      return reply.redirect(302, `${nbPrefix}/index.html`);
    });
  }

  const { pdfRoutes } = await import("./routes/pdfs");
  for (const prefix of routePrefixes) {
    await app.register(pdfRoutes, { prefix });
  }

  const { authRoutes } = await import("./routes/auth");
  for (const prefix of routePrefixes) {
    await app.register(authRoutes, { prefix });
  }

  if (process.env.LOG_ROUTES === '1') {
    app.addHook('onReady', async () => {
      app.log.info({ routes: app.printRoutes() }, 'Registered Fastify routes');
    });
  }

  // Serve frontend static bundle in production container.
  if (process.env.NODE_ENV === "production") {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: `${nbPrefix || ""}/`,
      index: ["index.html"],
      setHeaders(res, filePath) {
        res.setHeader("Cache-Control", cacheControlForStaticAsset(filePath));
      },
    });
  }

  app.setErrorHandler((err, request, reply) => {
    request.log.error({ err }, "Unhandled error");
    const anyErr = err as unknown as { code?: string; statusCode?: number };
    if (isApiKeyMissingError(err)) {
      return reply.code(400).send({
        error: {
          code: "API_KEY_MISSING",
          message: err.message,
        },
      });
    }
    if (
      anyErr.code === "FST_REQ_FILE_TOO_LARGE" ||
      anyErr.code === "FST_FILES_LIMIT"
    ) {
      return reply.code(413).send({
        error: {
          code: "FILE_TOO_LARGE",
          message: `File exceeds maximum size of ${config.maxUploadMb} MB`,
        },
      });
    }
    const status =
      anyErr.statusCode && anyErr.statusCode >= 400 ? anyErr.statusCode : 500;
    // An unexpected (uncaught) error's raw message can leak server internals — absolute file
    // paths from an ENOENT, db column/table names, etc. The full error is already logged above
    // for diagnosis; in production, only known error codes (status !== 500, handled explicitly
    // by the route) get their message echoed back to the client.
    const message =
      status === 500 && process.env.NODE_ENV === "production"
        ? "系統發生未預期的錯誤，請稍後再試"
        : err.message || "Internal error";
    return reply.code(status).send({
      error: {
        code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
        message,
      },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });

  return app;
}

/**
 * Start the backend server. Returns the port it is listening on.
 * Called both by the CLI entry point and by the Electron main process.
 */
export async function startServer(): Promise<number> {
  ensureWorkspaceRuntimePaths();
  await import("./db"); // Initialize DB and run migrations after path setup

  const { migrateLegacyPngToJpgOnStartup } =
    await import("./services/imageMigration");
  const { checkPoppler } = await import("./worker/poppler");
  const { getProcessingQueue } = await import("./worker/queue");
  const { rescanPendingOnStartup } = await import("./worker/pipeline");
  const { recoverOrphanedAddPagesPages } = await import("./worker/addPagesFromPrompt");

  ensureStorageRoot();
  await migrateLegacyPngToJpgOnStartup();

  // M3 cost-control observability: surface model + page cap on every boot.
  logger.info(
    {
      llmModel: config.openaiLlmModel,
      language: config.openaiScriptLanguage,
      targetChars: config.openaiScriptTargetChars,
      maxPages: config.openaiMaxPages,
      apiKey: config.openaiApiKey ? "(set)" : "(missing)",
    },
    "OpenAI M3 settings",
  );

  // M4: TTS settings
  logger.info(
    {
      ttsModel: config.openaiTtsModel,
      ttsVoice: config.openaiTtsVoice,
      ttsFormat: config.openaiTtsFormat,
      ttsSpeed: config.openaiTtsSpeed,
      ttsConcurrency: config.ttsConcurrency,
    },
    "OpenAI M4 TTS settings",
  );

  const popplerCheck = await checkPoppler();
  logger.info(
    { versionOutput: popplerCheck.versionOutput.trim().split("\n")[0] },
    "PDF renderer ready",
  );

  // Initialise queue + crash-recovery rescan
  getProcessingQueue();
  rescanPendingOnStartup();
  recoverOrphanedAddPagesPages();
  const rescanTimer = setInterval(() => {
    try {
      rescanPendingOnStartup();
    } catch (err) {
      logger.warn({ err }, 'Startup rescan interval failed (non-fatal)');
    }
  }, 30_000);
  rescanTimer.unref();

  const app = await buildApp();
  app.addHook("onClose", async () => {
    clearInterval(rescanTimer);
  });
  installShutdownHandlers(app);
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (err) {
    clearInterval(rescanTimer);
    await app.close().catch(() => undefined);
    throw err;
  }
  logger.info(
    {
      protocol: config.httpsKeyPath && config.httpsCertPath ? "https" : "http",
      port: config.port,
      storageRoot: config.storageRoot,
      dbPath: config.dbPath,
    },
    "Backend server listening",
  );
  return config.port;
}

function installShutdownHandlers(app: Awaited<ReturnType<typeof buildApp>>): void {
  if (process.env.NODE_ENV === "test") return;

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutdown signal received; closing backend server");
    try {
      await app.close();
      logger.info("Backend server closed");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Failed to close backend server cleanly");
      process.exit(1);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  try {
    await startServer();
  } catch (err) {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun && process.env.NODE_ENV !== 'test') {
  main();
}
