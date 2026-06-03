import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config";
import { logger } from "./logger";
import { decodeSession, parseCookies } from "./routes/auth";
import { getRuntimeAiSettings } from "./services/aiSettings";
import { ensureStorageRoot } from "./services/storage";
import { cacheControlForStaticAsset } from "./staticCache";

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

function isApiAuthExemptPath(pathname: string): boolean {
  return pathname === '/api/health'
    || pathname.startsWith('/api/auth/')
    || pathname.startsWith('/api/share/');
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

  app.addHook('onRequest', async (request, reply) => {
    const runtime = getRuntimeAiSettings();
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

    // 僅保護 API；前端靜態資源與頁面路由不在此攔截。
    if (!normalizedPath.startsWith('/api/')) return;

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
    return reply.code(status).send({
      error: {
        code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
        message: err.message || "Internal error",
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
  const rescanTimer = setInterval(() => {
    try {
      rescanPendingOnStartup();
    } catch (err) {
      logger.warn({ err }, 'Startup rescan interval failed (non-fatal)');
    }
  }, 30_000);
  rescanTimer.unref();

  const app = await buildApp();
  await app.listen({ port: config.port, host: "0.0.0.0" });
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
