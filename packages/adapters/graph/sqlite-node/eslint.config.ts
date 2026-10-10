import { defineConfig } from "eslint/config";
import { packageLintConfig } from "../../../../eslint.shared.ts";

export default defineConfig(
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    // Node-only by design: it opens databases with node:sqlite.
    projects: ["./tsconfig.json"],
  }),
);
