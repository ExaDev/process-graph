import type { KnipConfig } from "knip";

/**
 * Whole-workspace dead-code and unused-export analysis. Run as a root-only task, unlike every other check here: knip needs the full cross-package import graph to tell a genuinely unused export from one only ever consumed by a sibling package.
 *
 * A workspace entry exists for a layer only once the layer holds a package, since knip reports an entry matching nothing. The first package in `packages/adapters`, `packages/ui` or `packages/targets` adds its layer's entry, with the same `src/index` entry and `src/**` project as core.
 */
const config: KnipConfig = {
  workspaces: {
    ".": {
      entry: ["*.config.ts"],
      project: [
        "*.config.ts",
        "commit-types.ts",
        "eslint.shared.ts",
        "stryker.shared.ts",
      ],
    },
    "packages/core/*/*": {
      entry: ["src/index.{ts,tsx}"],
      project: ["src/**/*.{ts,tsx}!"],
    },
  },
  ignoreDependencies: [
    // Resolved by Stryker via its own config string, not a static import knip can see.
    "@stryker-mutator/typescript-checker",
    "@stryker-mutator/vitest-runner",
    // Resolved by semantic-release via the plugin-name strings in release.config.ts's own plugins array, not a static import knip can see.
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/github",
    // Resolved by name via each semantic-release plugin's own `preset: "conventionalcommits"` option string.
    "conventional-changelog-conventionalcommits",
  ],
};

export default config;
