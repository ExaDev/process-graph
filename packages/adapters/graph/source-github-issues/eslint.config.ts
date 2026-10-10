import { defineConfig } from "eslint/config";
import { packageLintConfig } from "../../../../eslint.shared.ts";

export default defineConfig(
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    isomorphic: true,
    // The Node entry point: it runs the GitHub CLI for a token, so it is Node-only by purpose and published as its own `./node` export.
    isomorphicExemptions: ["src/node.ts"],
  }),
);
