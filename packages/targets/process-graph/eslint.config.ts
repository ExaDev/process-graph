import { defineConfig } from "eslint/config";
import { packageLintConfig } from "../../../eslint.shared.ts";

export default defineConfig(
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    isomorphic: true,
    // The bin is a Node launcher that is run, never imported, so the library it carries stays isomorphic.
    isomorphicExemptions: ["src/bin.ts"],
  }),
);
