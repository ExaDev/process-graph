import { defineConfig } from "eslint/config";
import { packageLintConfig } from "../../../../eslint.shared.ts";

export default defineConfig(
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    isomorphic: true,
    // Written by scripts/embed-migrations.ts from the committed drizzle/ folder; build output, not source.
    additionalIgnores: ["src/generated"],
  }),
);
