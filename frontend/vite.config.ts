import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const rawNbPrefix = process.env.NB_PREFIX?.trim() ?? "";
const nbPrefix = rawNbPrefix ? `/${rawNbPrefix.replace(/^\/+|\/+$/g, "")}` : "";

/**
 * `vite build --watch` (start.sh all mode) must not put an inotify watch on every imported file
 * under node_modules — KaTeX alone ships dozens of font files — or it exhausts the kernel's
 * per-user watch limit (ENOSPC) and dies; and since a rebuild empties dist/ first, a crash midway
 * leaves the backend serving a dist/ without index.html.
 *
 * Done in `configResolved` rather than in `build.watch` directly: the CLI's `--watch` arrives as
 * `build.watch: true`, and that boolean replaces (not merges with) whatever the config file put
 * there, so an `exclude` written in `build` would silently be thrown away.
 */
const watchIgnoreNodeModules: Plugin = {
  name: "makeslide:watch-ignore-node-modules",
  configResolved(config) {
    if (!config.build.watch) return;
    const build = config.build as { watch: unknown; emptyOutDir: boolean };
    const previous = typeof config.build.watch === "object" ? config.build.watch : {};
    // A RegExp, not a glob: Vite registers CSS url() assets (the KaTeX fonts) with paths relative
    // to the root such as `../node_modules/katex/...`, and a `**` glob does not match a leading
    // `..` segment (picomatch treats it as a dot segment), so the glob form let them through.
    build.watch = { ...previous, exclude: [/[\\/]node_modules[\\/]/] };
    // Keep the previous output until the new one is written.
    build.emptyOutDir = false;
  },
};

export default defineConfig({
  base: "./",
  plugins: [react(), watchIgnoreNodeModules],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
  server: {
    allowedHosts: true,
    port: 5173,
    proxy: {
      [`${nbPrefix}/api`]: {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
