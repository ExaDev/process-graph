# process-graph

A process and dependency graph model, with the reasoning, command line and React UI built on it, over work tracked in several systems at once. One layout-free model carries activities, participants, transitions and decisions; a flowchart, a swimlane, a state machine and a sequence diagram are views of it. GitHub issues are the first source, and further sources are adapters behind one port.

TypeScript, ESM, pnpm workspaces, Turborepo, Vitest, ESLint with `@exadev/eslint-config`, semantic-release.

## Getting started

Node and pnpm versions are pinned in `.tool-versions` and `package.json`'s `packageManager`; install through mise.

```sh
pnpm install
pnpm build
pnpm test
```

Dependencies are added with `pnpm add`, never by editing a version by hand. Every manifest pins exact versions (`syncpack` enforces it), and the install age gate in `pnpm-workspace.yaml` is never lowered; ExaDev's own packages are the only entries in `minimumReleaseAgeExclude`.

## Commands

```sh
pnpm build              # tsc -b across the workspace, dependency-ordered
pnpm lint               pnpm lint:fix               pnpm typecheck
pnpm test               pnpm test:coverage          pnpm test:smoke
pnpm test:mutation      pnpm exec knip              pnpm run deps:lint
```

Every command runs through Turborepo, so an unchanged package replays a cached result. `pnpm lint` only checks; `pnpm lint:fix` is the separate task that rewrites. Run a single test file with `pnpm --dir <package> exec vitest run --project unit <file>`.

## Layout

```text
packages/
├── core/<domain>/<package>/        # the model, its analysis and the ports; no adapter, UI or target knowledge
├── adapters/<domain>/<package>/    # an implementation of a core port against one external system
├── ui/<domain>/<package>/          # components that render the model
└── targets/<package>/              # deployable entry points, deliberately flat
```

A package may depend on its own layer and the layers below it, never above; `no-uphill-dependency` and `no-dependency-cycle` from `@exadev/eslint-config` enforce it from the manifests, configured in `eslint.shared.ts`. Published names are `@exadev/process-graph-<name>`; the unscoped `process-graph` package is the umbrella that re-exports the model and carries the CLI.

Configuration lives at exactly one of two levels: in the package (`eslint.config.ts`, `tsconfig*.json`, Vitest projects, Stryker) or at the root (commit rules, git hooks, formatting, release).

## Packages

Packages are listed here as they are added, each linking to its own README.

## Conventions

- **One instruction file.** This README is also `AGENTS.md` and `CLAUDE.md`, which are symlinks to it, in the root and in every package.
- **Report, never absorb.** Unknown references and cycles are returned as data; an operation that is undefined on a cyclic graph throws an error carrying the cycles.
- **Isomorphic core.** Core packages import nothing Node-only (`isomorphic: true` in the package's lint config), so they run in a browser, a Worker or Node unchanged.
- **Type safety.** No `any`, no `as` outside `as const`, no non-null assertions, no lint suppressions. Narrow `unknown` with `in` and guards.
- **Iterative graph algorithms.** Graph traversals use explicit stacks, so depth is bounded by memory, not the call stack.
- **Evergreen content.** Docs and comments state what things are and why, never counts, sizes or today's data shape.
- **Commits.** Conventional commits, types from `commit-types.ts` (the single source for commitlint and release rules), bodies wrapped at 100 columns, staged by file name.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for adding a package and for the release strategy.
