import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { defineConfig } from "vitest/config";

/**
 * happy-dom, as the UI packages use: the screen tests render the app against an in-memory store and source with Testing Library, laid out by a stub engine, with the Vanilla Extract plugin compiling the app's own styles. The smoke test reads the built `dist/`. The end-to-end tests are Playwright's, run by `test:e2e`, not here.
 */
export default defineConfig({
  plugins: [vanillaExtractPlugin()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}", "build/**/*.test.ts"],
          environment: "happy-dom",
        },
      },
      {
        extends: true,
        test: {
          name: "smoke",
          include: ["test/**/*.smoke.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
