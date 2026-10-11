import type { RcFile } from "syncpack";

/**
 * One version per library, written once. The private packages, the workspace root included, take every third-party version from the catalog in `pnpm-workspace.yaml` (`catalog:`) and every sibling through the workspace protocol (`workspace:*`).
 *
 * The published `process-graph` package cannot: `@semantic-release/npm` publishes with `npm publish`, which ships a `catalog:` or `workspace:` specifier verbatim, so its manifest names exact versions. syncpack's catalog policy would rewrite those into `catalog:`, so the package is left to `scripts/check-published-manifests.ts`, the other half of `deps:lint`, which holds each of its versions exact and equal to the catalog entry or the sibling's own version, and each catalog entry exact. Version groups match first to last, so that exemption comes before the two groups that would otherwise claim its dependencies.
 */
const config: RcFile = {
  versionGroups: [
    {
      label:
        "the published package, checked by scripts/check-published-manifests.ts instead",
      packages: ["process-graph"],
      isIgnored: true,
    },
    {
      label:
        "a private package names its siblings through the workspace protocol",
      dependencies: ["$LOCAL"],
      dependencyTypes: ["!local"],
      pinVersion: "workspace:*",
    },
    {
      label:
        "a private package takes every third-party version from the catalog",
      dependencyTypes: ["!local"],
      policy: "catalog",
    },
  ],
};

export default config;
