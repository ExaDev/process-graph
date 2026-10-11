# process-graph

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![Release](https://img.shields.io/github/v/release/ExaDev/process-graph)](https://github.com/ExaDev/process-graph/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

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

A package may depend on its own layer and the layers below it, never above; `no-uphill-dependency` and `no-dependency-cycle` from `@exadev/eslint-config` enforce it from the manifests, configured in `eslint.shared.ts`. Published names are `@exadev/process-graph-<name>`; the unscoped [`process-graph`](packages/targets/process-graph/README.md) package, in the `targets` layer, is the primary entry point: it re-exports the model, projection, domain and DAG packages so a consumer installs one dependency.

Configuration lives at exactly one of two levels: in the package (`eslint.config.ts`, `tsconfig*.json`, Vitest projects, Stryker) or at the root (commit rules, git hooks, formatting, release).

## Packages

| Package                                                                                | What it is                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`graph-dag`](packages/core/graph/dag/README.md)                                       | Model-independent dependency-graph primitives over a node set and a `needs` accessor: layers, ancestors, descendants, cycles, transitive reduction, critical path.                                                                                |
| [`graph-schema`](packages/core/graph/schema/README.md)                                 | The process model: typed identifier spaces, `defineModel` with compile-time reference checking, structural validation.                                                                                                                            |
| [`graph-projection`](packages/core/graph/projection/README.md)                         | Projections of the model into a flowchart, swimlane, state machine and sequence diagram, plus derived hand-offs, and the inverses that turn an edited view into a diff against the model.                                                         |
| [`graph-domain`](packages/core/graph/domain/README.md)                                 | Reasoning over the model and a run overlay: control graph, illegal cycles, three-valued status, ready set, blocked-by, impact, what-if and critical path.                                                                                         |
| [`graph-layout`](packages/core/graph/layout/README.md)                                 | Layered layout of a projected flowchart, swimlane or state machine into positions in the model's `views` shape.                                                                                                                                   |
| [`graph-source-contract`](packages/core/graph/source-contract/README.md)               | The `GraphSource` port as an oRPC contract: versioned, paged and streamed sync of bound activities, participants, transitions and run state, resumable by cursor, typed filters and scope listings, with an in-memory fake and a conformance kit. |
| [`graph-source-github-issues`](packages/adapters/graph/source-github-issues/README.md) | The GitHub issues adapter for the `GraphSource` port: issues, `blockedBy` and `blocking`, sub-issues and assignees across organisations, repositories and Projects v2 boards, with server-side filters, a scope listing and per-owner tokens.     |
| [`graph-store-contract`](packages/core/graph/store-contract/README.md)                 | The persistence port as an oRPC contract: save, load and delete models, set run state, upsert items from a source, structural ready, blocked-chain and impact queries, and a change feed; with an in-memory fake and a conformance kit.           |
| [`graph-store-sqlite`](packages/adapters/graph/store-sqlite/README.md)                 | The store port on SQLite through Drizzle: one table definition, committed drizzle-kit migrations applied the same way in every runtime, recursive SQL for the structural queries, against Drizzle's async SQLite database so any driver plugs in. |
| [`graph-sqlite-node`](packages/adapters/graph/sqlite-node/README.md)                   | The SQLite store on Node's built-in `node:sqlite` through `drizzle-orm/node-sqlite`, for the command line and servers.                                                                                                                            |
| [`graph-sqlite-wasm`](packages/adapters/graph/sqlite-wasm/README.md)                   | The SQLite store in the browser: SQLite wasm in a dedicated worker on OPFS `opfs-sahpool`, shared between tabs under a Web Lock with no special headers, served to the page over oRPC.                                                            |
| [`graph-react`](packages/ui/graph/react/README.md)                                     | Headless React hooks and unstyled components: follow a stored model, derive statuses, the ready set, blocked chains, impact and explanations, project views, filter, select and navigate by keyboard.                                             |
| [`graph-ui`](packages/ui/graph/ui/README.md)                                           | Styled components over `graph-react` and an SVG sequence diagram, in Vanilla Extract with a typed theme contract and light and dark themes, shipped as compiled CSS.                                                                              |
| [`graph-react-flow`](packages/ui/graph/react-flow/README.md)                           | React Flow views of the model: flowchart, swimlane with lanes as group nodes, and state machine, laid out by `graph-layout`, showing each status and the critical path; sequence projections drawn by `graph-ui`.                                 |
| [`process-graph`](packages/targets/process-graph/README.md)                            | The primary entry point: re-exports the schema, projection and domain APIs flat and the DAG API as the `dag` namespace.                                                                                                                           |

## Conventions

- **One instruction file.** This README is also `AGENTS.md` and `CLAUDE.md`, which are symlinks to it, in the root and in every package.
- **Report, never absorb.** Unknown references and cycles are returned as data; an operation that is undefined on a cyclic graph throws an error carrying the cycles.
- **Isomorphic core.** Core packages import nothing Node-only (`isomorphic: true` in the package's lint config), so they run in a browser, a Worker or Node unchanged.
- **Type safety.** No `any`, no `as` outside `as const`, no non-null assertions, no lint suppressions. Narrow `unknown` with `in` and guards.
- **Iterative graph algorithms.** Graph traversals use explicit stacks, so depth is bounded by memory, not the call stack.
- **Evergreen content.** Docs and comments state what things are and why, never counts, sizes or today's data shape.
- **Commits.** Conventional commits, types from `commit-types.ts` (the single source for commitlint and release rules), bodies wrapped at 100 columns, staged by file name.

## Releases

Each package versions and publishes independently through [`@exadev/semantic-release-workspace`](https://github.com/ExaDev/semantic-release-workspace), configured in `release-workspace.config.ts` and run by the `release` job in CI. A package releases when commits touch its own directory, or when a sibling it depends on releases; packages release in dependency order, so the entry point follows the packages it re-exports. Tags are `<name>@<version>`, and each package keeps its own `CHANGELOG.md`.

The release commit and tags are pushed to the protected `main` with a repository deploy key (the `RELEASE_DEPLOY_KEY` secret) over SSH, because `GITHUB_TOKEN` cannot bypass a ruleset; the `main` ruleset lists that deploy key as a bypass actor. `GITHUB_TOKEN` is still used for the GitHub API calls that create releases and comment on issues and pull requests.

A new package name must be reserved on npm, and its trusted publisher registered, by a person before its first CI publish; the steps are in CONTRIBUTING.md.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for adding a package, the release strategy and bootstrapping a package name.
