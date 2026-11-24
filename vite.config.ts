import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    outDir: "dist",
    target: "es2022",
    // three.js alone is ~530 KB minified (~133 KB gzip); expected
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: { manualChunks: { three: ["three"] } },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
