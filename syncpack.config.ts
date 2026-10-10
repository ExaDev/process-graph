import type { RcFile } from "syncpack";

/**
 * Exact-pin everywhere, third-party and internal-sibling dependencies alike, matching documents.js's own convention: an exact pin means a version bump anywhere is a visible, reviewable diff, at the cost of dependencies no longer deduping against a compatible range a consumer's other dependencies might bring in. `deps:lint` is a required CI check and a pre-commit hook step against any staged package.json.
 *
 * `versionGroups` deliberately has no entry exempting the root `monorepo-template` manifest: an earlier draft ignored it outright via `isIgnored: true`, which turned out to suppress every check on the root's dependencies, not just cross-package version-mismatch comparison. A caret range reintroduced into the root `package.json` for testing passed `syncpack lint` silently while that exemption was in effect. Root's own shared tool pins (`typescript`, `vitest`, ...) are meant to be kept in sync with every package's copy of the same dependency, so they belong in the default version group like everything else.
 */
const config: RcFile = {
  semverGroups: [
    {
      label: "exact versions everywhere",
      dependencies: ["**"],
      dependencyTypes: ["prod", "dev"],
      range: "",
    },
  ],
};

export default config;
