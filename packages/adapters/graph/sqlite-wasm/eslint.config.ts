import { defineConfig } from "eslint/config";
import { packageLintConfig } from "../../../../eslint.shared.ts";

export default defineConfig(
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    projects: [
      "./tsconfig.json",
      "./tsconfig.node.json",
      "./tsconfig.browser.json",
    ],
    isomorphic: true,
    // It starts and talks to workers, BroadcastChannels and Web Locks.
    browserGlobals: true,
  }),
);
