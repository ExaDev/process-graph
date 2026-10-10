import { defineConfig } from "eslint/config";
import { packageLintConfig } from "./eslint.shared.ts";

/**
 * Lints only the root's own tooling files. Every package lints itself via its own eslint.config.ts, which calls packageLintConfig(). Configuration that is a property of the repository lives here; configuration that is genuinely per-package lives in the package.
 */
export default defineConfig(
  { ignores: ["packages/**", "infrastructure/**"] },
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    projects: ["./tsconfig.json"],
    // No index files at all at root. The root's own tooling (config files, .github/scripts/) has no external consumer that needs a re-export surface, so there's nothing a barrel would be for.
    barrelPolicy: "banned",
  }),
);
