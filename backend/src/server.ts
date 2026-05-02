import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from './config';
import { logger } from './logger';
import { pdfRoutes } from './routes/pdfs';
import { ensureStorageRoot } from './services/storage';
import { checkPoppler } from './worker/poppler';
import { rescanPendingOnStartup } from './worker/pipeline';
import { getProcessingQueue } from './worker/queue';
import './db'; // Initialize DB and run migrations

export async function buildApp() {
  const app = Fastify({
    logger,
    bodyLimit: config.maxUploadBytes + 1024 * 1024, // small slack for headers
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
    },
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(pdfRoutes);

  app.setErrorHandler((err, request, reply) => {
    request.log.error({ err }, 'Unhandled error');
    const anyErr = err as unknown as { code?: string; statusCode?: number };
    if (anyErr.code === 'FST_REQ_FILE_TOO_LARGE' || anyErr.code === 'FST_FILES_LIMIT') {
      return reply.code(413).send({
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File exceeds maximum size of ${config.maxUploadMb} MB`,
        },
      });
    }
    const status = anyErr.statusCode && anyErr.statusCode >= 400 ? anyErr.statusCode : 500;
    return reply.code(status).send({
      error: {
        code: status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message: err.message || 'Internal error',
      },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    });
  });

  return app;
}

async function main(): Promise<void> {
  ensureStorageRoot();

  // M3 cost-control observability: surface model + page cap on every boot.
  logger.info(
    {
      llmModel: config.openaiLlmModel,
      language: config.openaiScriptLanguage,
      targetChars: config.openaiScriptTargetChars,
      maxPages: config.openaiMaxPages,
      apiKey: config.openaiApiKey ? '(set)' : '(missing)',
    },
    'OpenAI M3 settings',
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
    'OpenAI M4 TTS settings',
  );

  // Warn (but don't crash) when poppler binaries are unavailable — the
  // pipeline will fail clearly for individual jobs in that case.
  const popplerCheck = await checkPoppler();
  if (!popplerCheck.pdftoppm || !popplerCheck.pdfinfo) {
    logger.warn(
      {
        popplerBinPath: config.popplerBinPath || '(PATH)',
        pdftoppm: popplerCheck.pdftoppm,
        pdfinfo: popplerCheck.pdfinfo,
      },
      'poppler-utils not fully available — install with e.g. `sudo apt-get install poppler-utils` or `brew install poppler`. PDF processing will fail until this is resolved.',
    );
  } else {
    logger.info(
      { versionOutput: popplerCheck.versionOutput.trim().split('\n')[0] },
      'poppler-utils detected',
    );
  }

  // Initialise queue + crash-recovery rescan
  getProcessingQueue();
  rescanPendingOnStartup();

  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(
      { port: config.port, storageRoot: config.storageRoot, dbPath: config.dbPath },
      'Backend server listening',
    );
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
