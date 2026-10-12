import { defineConfig } from "eslint/config";
import { version } from "react";
import { packageLintConfig } from "../../../eslint.shared.ts";

/**
 * A browser app: runtime `src/` imports nothing Node-only and has the browser's globals, and `.tsx` files get the React, hooks and accessibility rules for the React this package installs. The build script, Vite and Playwright configuration and the end-to-end tests run in Node under `tsconfig.node.json`. Vite's output and Playwright's reports are produced files, not source.
 */
export default defineConfig(
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    isomorphic: true,
    browserGlobals: true,
    react: { version },
    additionalIgnores: [
      "dev-dist",
      "dist-base-path",
      "playwright-report",
      "test-results",
    ],
  }),
);
