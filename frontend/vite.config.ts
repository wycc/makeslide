import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rawNbPrefix = process.env.NB_PREFIX?.trim() ?? "";
const nbPrefix = rawNbPrefix ? `/${rawNbPrefix.replace(/^\/+|\/+$/g, "")}` : "";

export default defineConfig({
  base: "./",
  plugins: [react()],
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
