import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { defineConfig } from "vitest/config";

/**
 * happy-dom, as the owner's other React packages use. The unit tests run the Vanilla Extract plugin and process CSS, so this package's own styles compile as they do in the build; layouts come from a stub engine, so no test needs elkjs. The smoke test renders the built `dist/`.
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
