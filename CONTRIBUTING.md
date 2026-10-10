# Contributing

## Adding a package

1. Pick the layer: `packages/core/<domain>/<name>` for the model, its analysis and ports; `packages/adapters/<domain>/<name>` for an implementation of a port against one external system; `packages/ui/<domain>/<name>` for components; `packages/targets/<name>` (flat) for a deployable entry point.
2. Copy the closest existing package's shape: `package.json` (`exports` map, script set), `tsconfig.json` plus `tsconfig.build.json` (and `tsconfig.node.json` for an isomorphic package), `eslint.config.ts`, `vitest.config.ts`, `stryker.config.ts`, `test/package.smoke.test.ts`.
3. Name it `@exadev/process-graph-<name>` and pin every internal dependency exact (`syncpack lint` enforces it). `workspace:` ranges are not used.
4. Add its `tsconfig.build.json` to the root `tsconfig.build.json` `references`.
5. If it is the first package in its layer, add that layer's workspace entry to `knip.config.ts` (an entry that matches nothing is a knip hint).
6. Write its `README.md`, then `ln -s README.md AGENTS.md && ln -s README.md CLAUDE.md`.
7. Add it to the packages table in the root `README.md`, and to the Dependabot `ignore` list only if its name does not already match `@exadev/process-graph-*`.
8. Give the manifest what the release orchestrator needs (see [Release strategy](#release-strategy)): `version` `0.0.0`, `repository.directory` set to the package's path, `publishConfig` with `access`, `provenance` and the registry as in its siblings, and each sibling dependency as the sibling's exact version.
9. Reserve the name on npm and register its trusted publisher before its first releasable commit reaches `main` (see [Bootstrapping a package name](#bootstrapping-a-package-name)).
10. Verify with the repository scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:smoke`, `pnpm exec knip`, `pnpm run deps:lint`.
11. Commit as `feat: add <name> package`, describing the package's role and any deliberate decision, not the process that produced it.

## Release strategy

Every publishable package versions and publishes on its own. `release-workspace.config.ts` configures [`@exadev/semantic-release-workspace`](https://github.com/ExaDev/semantic-release-workspace), which the `release` job in `.github/workflows/ci.yml` runs as `pnpm release` on every push to `main` once the other jobs have passed.

- The orchestrator discovers the packages from `pnpm-workspace.yaml`, orders them by their dependencies on one another and releases each after every sibling it depends on, so the `process-graph` entry point is released after the building-block packages it re-exports.
- A package's release is decided from the commits that touched its own directory, using the types and release levels in `commit-types.ts`. A commit that touches no package directory releases nothing, and a commit scope has no effect on which package releases.
- Each release is a `<name>@<version>` tag, a package-level `CHANGELOG.md` and a GitHub Release. The whole run's version bumps, changelog entries and dependency-range rewrites are committed once and pushed atomically with the tags before anything is published.
- When a package releases, every dependent's sibling range is rewritten to the new version, the lockfile is regenerated and the dependent releases a patch even if nothing else about it changed, so a published manifest never names a version the repository has moved past. Sibling dependencies are exact versions rather than the `workspace:` protocol for this reason: `npm publish` ships a specifier as written.
- Publishing uses npm trusted publishing (OIDC): `id-token: write` on the job, no `NPM_TOKEN`, and no `registry-url` on `setup-node`, because that writes a token line that wins over the OIDC exchange.

Release configuration lives only in `release-workspace.config.ts`. The orchestrator sets the tag format, plugins and analysis options on every per-package run, so a `release.config.*` inside a package would be overridden rather than honoured.

To see what a run would do without tagging, committing, pushing or publishing, run `pnpm release --dry-run` from the root on a clean tree and a pushed branch, with `--branches <branch>` naming it and a `GITHUB_TOKEN` in the environment.

### Bootstrapping a package name

npm has no trusted publisher settings page for a name that has never been published, so a new package's name is reserved and its trusted publisher registered by a person before CI publishes it for the first time:

```sh
npm-reserve <name> --trust ExaDev/process-graph --workflow ci.yml
```

A first publish from CI under an unregistered name fails the OIDC exchange. The run has already pushed the tag by then, so that version is skipped rather than retried; see the orchestrator's README for recovering from it.

### Adding a package to releases

A package joins releases by being a non-private workspace package: no other registration exists. Its manifest carries the fields named in the steps of [Adding a package](#adding-a-package), its first release is `1.0.0` because it has no earlier tag, and a private package is still versioned and tagged but never published.
