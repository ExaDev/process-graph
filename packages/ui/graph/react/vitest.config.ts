import { defineConfig } from "vitest/config";

/**
 * happy-dom, as the owner's other React packages use: the tests render components and query them with Testing Library, and the smoke test renders the built `dist/` the same way.
 */
export default defineConfig({
  test: {
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
