import { defineConfig } from "eslint/config";
import { version } from "react";
import { packageLintConfig } from "../../../../eslint.shared.ts";

/**
 * A browser React library: runtime `src/` imports nothing Node-only, browser globals are in scope, and `.tsx` files get the React, hooks and accessibility rules for the React this package installs.
 */
export default defineConfig(
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    isomorphic: true,
    browserGlobals: true,
    react: { version },
  }),
);
