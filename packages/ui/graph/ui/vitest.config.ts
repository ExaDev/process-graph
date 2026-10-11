import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { defineConfig } from "vitest/config";

/**
 * happy-dom, as the owner's other React packages use. The unit tests run the Vanilla Extract plugin and process CSS, so the rendered components carry the real class names and the document holds the real rules, and a test can read the theme's custom properties back through `getComputedStyle`. The smoke test renders the built `dist/` with its compiled stylesheet.
 */
export default defineConfig({
  plugins: [vanillaExtractPlugin()],
  test: {
    css: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}"],
          environment: "happy-dom",
        },
      },
      {
        extends: true,
        test: {
          name: "smoke",
          include: ["test/package.smoke.test.tsx"],
          environment: "happy-dom",
        },
      },
    ],
  },
});
