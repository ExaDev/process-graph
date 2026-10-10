import { defineConfig } from "eslint/config";
import { packageLintConfig } from "../../../eslint.shared.ts";

export default defineConfig(
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    isomorphic: true,
  }),
);
