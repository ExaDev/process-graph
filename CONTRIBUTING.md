# Contributing

## Adding a package

1. Pick the layer: `packages/core/<domain>/<name>` for the model, its analysis and ports; `packages/adapters/<domain>/<name>` for an implementation of a port against one external system; `packages/ui/<domain>/<name>` for components; `packages/targets/<name>` (flat) for a deployable entry point.
2. Copy the closest existing package's shape: `package.json` (`exports` map, script set), `tsconfig.json` plus `tsconfig.build.json` (and `tsconfig.node.json` for an isomorphic package), `eslint.config.ts`, `vitest.config.ts`, `stryker.config.ts`, `test/package.smoke.test.ts`.
3. Name it `@exadev/process-graph-<name>` and pin every internal dependency exact (`syncpack lint` enforces it). `workspace:` ranges are not used.
4. Add its `tsconfig.build.json` to the root `tsconfig.build.json` `references`.
5. If it is the first package in its layer, add that layer's workspace entry to `knip.config.ts` (an entry that matches nothing is a knip hint).
6. Write its `README.md`, then `ln -s README.md AGENTS.md && ln -s README.md CLAUDE.md`.
7. Add it to the packages table in the root `README.md`, and to the Dependabot `ignore` list only if its name does not already match `@exadev/process-graph-*`.
8. Verify with the repository scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:smoke`, `pnpm exec knip`, `pnpm run deps:lint`.
9. Commit as `feat: add <name> package`, describing the package's role and any deliberate decision, not the process that produced it.

## Release strategy

`release.config.ts` runs plain `semantic-release` on every qualifying push to `main`: one shared version, one shared `CHANGELOG.md`, one shared tag and GitHub Release, derived from the whole repository's history. `npmPublish` is false: nothing is published to the npm registry from here yet.

Publishing is a separate step that needs each package's trusted publisher registered on npm (a registry setting, made by a person) and a first manual publish where npm has no settings page for a never-published name. Independent per-package versions then come from `@exadev/semantic-release-workspace` replacing `release.config.ts`, which keeps `commit-types.ts` as the single source of commit types.
