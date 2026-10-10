import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "smoke", include: ["test/package.smoke.test.ts"] },
      },
      {
        extends: true,
        optimizeDeps: {
          // The worker module is only found when a test starts a worker, so Vite would discover its dependencies mid-run and reload the page under the running tests. Scanning every browser test file, the worker included, up front optimises them before the first test.
          entries: ["test/browser/**/*.ts"],
          // SQLite's wasm module loads its own .wasm file relative to itself, which pre-bundling would break.
          exclude: ["@sqlite.org/sqlite-wasm"],
        },
        test: {
          name: "browser",
          include: ["test/browser/**/*.test.ts"],
          // Served by Vite as configured here, with no Cross-Origin-Opener-Policy or Cross-Origin-Embedder-Policy headers: the store must work without cross-origin isolation.
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
