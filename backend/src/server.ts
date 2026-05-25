import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config";
import { logger } from "./logger";
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

  app.get('/api/health', async () => ({ ok: true }));
  if (nbPrefix) {
    app.get(withNbPrefix('/api/health'), async () => ({ ok: true }));
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

async function main(): Promise<void> {
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

  // Warn (but don't crash) when poppler binaries are unavailable — the
  // pipeline will fail clearly for individual jobs in that case.
  const popplerCheck = await checkPoppler();
  if (!popplerCheck.pdftoppm || !popplerCheck.pdfinfo) {
    logger.warn(
      {
        popplerBinPath: config.popplerBinPath || "(PATH)",
        pdftoppm: popplerCheck.pdftoppm,
        pdfinfo: popplerCheck.pdfinfo,
      },
      "poppler-utils not fully available — install with e.g. `sudo apt-get install poppler-utils` or `brew install poppler`. PDF processing will fail until this is resolved.",
    );
  } else {
    logger.info(
      { versionOutput: popplerCheck.versionOutput.trim().split("\n")[0] },
      "poppler-utils detected",
    );
  }

  // Initialise queue + crash-recovery rescan
  getProcessingQueue();
  rescanPendingOnStartup();
  // Defensive self-healing: periodically rescan pending rows in case a job
  // stays in `uploaded` after transient enqueue misses.
  const rescanTimer = setInterval(() => {
    try {
      rescanPendingOnStartup();
    } catch (err) {
      logger.warn({ err }, 'Startup rescan interval failed (non-fatal)');
    }
  }, 30_000);
  rescanTimer.unref();

  const app = await buildApp();
  try {
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
