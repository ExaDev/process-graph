import { defineConfig } from "eslint/config";
import { packageLintConfig } from "../../../eslint.shared.ts";

export default defineConfig(
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    // Node-only by design: it is the command line, opening the store with node:sqlite and writing to the process's streams.
    projects: ["./tsconfig.json"],
  }),
);
