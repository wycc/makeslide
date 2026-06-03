#!/usr/bin/env node
// esbuild config for Electron packaging — avoids shell-quoting issues with --define
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/server.bundle.cjs',
  external: [
    'better-sqlite3',
    'sharp',
    '@img',
    'canvas',
    'ffmpeg-static',
    'pdfjs-dist',
  ],
  define: {
    'import.meta.url': '__importMetaUrl',
    // Bake NODE_ENV so pino-pretty transport branch is dead-code eliminated
    'process.env.NODE_ENV': '"production"',
  },
  banner: {
    js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
  },
});
