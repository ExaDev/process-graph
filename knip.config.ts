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
    "packages/adapters/*/*": {
      entry: ["src/index.{ts,tsx}"],
      project: ["src/**/*.{ts,tsx}!"],
    },
    "packages/ui/*/*": {
      entry: ["src/index.{ts,tsx}"],
      project: ["src/**/*.{ts,tsx}!"],
    },
    "packages/targets/process-graph": {
      // Its entries are its tsdown entries, the bin included, which knip's tsdown plugin reads.
      project: ["src/**/*.{ts,tsx}!"],
      // Optional peer dependencies of the bundle that nothing else in this workspace declares as a peer. Each is also a devDependency, as `pnpm add --save-peer` writes it, so the built bundle that the smoke tests run resolves it here; only the bundle imports it, since `src/` reaches it through the workspace packages it inlines, and knip traces `src/`. knip reports an entry here that stops being needed and a new peer missing from it, so the list cannot drift silently.
      ignoreDependencies: [
        "@orpc/client",
        "@sqlite.org/sqlite-wasm",
        "commander",
        "elkjs",
      ],
    },
    "packages/targets/*": {
      // A target's bin is an entry point of its own, run as a process rather than imported.
      entry: ["src/index.{ts,tsx}", "src/bin.ts"],
      project: ["src/**/*.{ts,tsx}!"],
    },
    // An app rather than a library: knip's Vite plugin finds the page's module from index.html; the store's worker, which main.tsx starts by URL, the build script and the Playwright suite are entries of their own.
    "packages/targets/graph-web": {
      entry: ["src/store.worker.ts!", "build/icons.ts", "e2e/**/*.ts"],
      project: ["src/**/*.{ts,tsx}!", "build/**/*.ts", "e2e/**/*.ts"],
    },
  },
  ignoreDependencies: [
    // Resolved by name via each semantic-release plugin's own `preset: "conventionalcommits"` option string.
    "conventional-changelog-conventionalcommits",
  ],
};

export default config;
