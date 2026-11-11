import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws outside a React Server Component bundle.
      "server-only": fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Each database test file runs its own in-process Postgres, and the OCR
    // test runs Tesseract. With one worker per core these can exhaust memory
    // and crash workers on Windows, so cap the parallelism.
    maxWorkers: 4,
    testTimeout: 30_000,
  },
});
