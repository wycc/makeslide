import type { FastifyInstance } from 'fastify';

// Thin entrypoint kept so `import('./routes/pdfs')` (file resolution wins over the
// directory) delegates to the real, modularized routes under ./pdfs/. The former
// monolithic implementation that lived here has been fully migrated into ./pdfs/*
// and was dead code (only this shim was ever exported/used).
export async function pdfRoutes(app: FastifyInstance): Promise<void> {
  return import('./pdfs/index').then((m) => m.pdfRoutes(app));
}
