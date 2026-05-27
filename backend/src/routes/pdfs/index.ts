import type { FastifyInstance } from 'fastify';
import { registerUploadRoutes } from './upload';
import { registerDetailRoutes } from './detail';
import { registerPageOperationsRoutes } from './page-operations';
import { registerRegenerateRoutes } from './regenerate';
import { registerAdminRoutes } from './admin';
import { registerDeleteRoutes } from './delete';
import { registerObservabilityRoutes } from './observability';
import { registerSyncRoutes } from './sync';
import { registerQuizRoutes } from './quizzes';
import { registerHandoutRoutes } from './handout';
import { registerExportRoutes } from './export';
import { registerImportRoutes } from './import';

export async function pdfRoutes(app: FastifyInstance): Promise<void> {
  await registerUploadRoutes(app);
  await registerDetailRoutes(app);
  await registerDeleteRoutes(app);
  await registerPageOperationsRoutes(app);
  await registerRegenerateRoutes(app);
  await registerAdminRoutes(app);
  await registerObservabilityRoutes(app);
  await registerSyncRoutes(app);
  await registerQuizRoutes(app);
  await registerHandoutRoutes(app);
  await registerExportRoutes(app);
  await registerImportRoutes(app);
}
