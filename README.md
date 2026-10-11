# process-graph

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![Release](https://img.shields.io/github/v/release/ExaDev/process-graph)](https://github.com/ExaDev/process-graph/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

A process and dependency graph model, with the reasoning, command line and React UI built on it, over work tracked in several systems at once. One layout-free model carries activities, participants, transitions and decisions; a flowchart, a swimlane, a state machine and a sequence diagram are views of it. GitHub issues are the first source, and further sources are adapters behind one port.

TypeScript, ESM, pnpm workspaces, Turborepo, Vitest, ESLint with `@exadev/eslint-config`, semantic-release.

## Install

```sh
pnpm add process-graph
```

The root entry needs `zod` and `trilean`, which install with it; each other subpath names the optional peers to install beside it in the [`process-graph` README](packages/targets/process-graph/README.md). A project with an install age gate, such as pnpm's `minimumReleaseAge`, must exempt `trilean` and its own dependency `trilean-regex` as well as `process-graph`, since both are ExaDev packages released alongside it and are often younger than the gate; with pnpm, add all three to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.

## Getting started

Node and pnpm versions are pinned in `.tool-versions` and `package.json`'s `packageManager`; install through mise.

```sh
pnpm install
pnpm build
pnpm test
```

Dependencies are added with `pnpm add`, never by editing a version by hand. Every third-party version is written once, exactly, in the catalog in `pnpm-workspace.yaml`: a private package names it as `catalog:` (`pnpm add --save-catalog <name>@<version>`) and a sibling as `workspace:*`. The published `process-graph` manifest names literal versions instead, because `npm publish` ships a protocol specifier verbatim: its dependencies exactly, and its peer dependencies as caret ranges on the lowest tested version, which the catalog's version satisfies, except a prerelease peer (oRPC's betas, Drizzle's release candidate), which stays exact because a prerelease has no compatible-range semantics; `pnpm run deps:lint` (`syncpack` and `scripts/check-published-manifests.ts`) holds both rules. The install age gate in `pnpm-workspace.yaml` is never lowered; ExaDev's own packages are the only entries in `minimumReleaseAgeExclude`.

## Commands

```sh
pnpm build              # every package, dependency-ordered; process-graph last, bundled by tsdown
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

A package may depend on its own layer and the layers below it, never above; `no-uphill-dependency` and `no-dependency-cycle` from `@exadev/eslint-config` enforce it from the manifests, configured in `eslint.shared.ts`. One package is published: the unscoped [`process-graph`](packages/targets/process-graph/README.md), in the `targets` layer. Every other package is private, named `@exadev/process-graph-<name>`, and reaches consumers only bundled into `process-graph` behind one of its subpath exports, so a consumer installs one dependency and imports each part from its own subpath.

Configuration lives at exactly one of two levels: in the package (`eslint.config.ts`, `tsconfig*.json`, Vitest projects, Stryker) or at the root (commit rules, git hooks, formatting, release).

## Packages

The published package:

| Package                                                     | What it is                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`process-graph`](packages/targets/process-graph/README.md) | The one install: the model, projection, domain and DAG APIs at the root entry, layout, the GitHub issues source, the SQLite store for Node and the browser, the React UI and the command line library each behind a subpath, and the `process-graph` bin. |

The internal packages, private and bundled into `process-graph`:

| Package                                                                                | What it is                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`graph-dag`](packages/core/graph/dag/README.md)                                       | Model-independent dependency-graph primitives over a node set and a `needs` accessor: layers, ancestors, descendants, cycles, transitive reduction, critical path.                                                                                                                                                 |
| [`graph-schema`](packages/core/graph/schema/README.md)                                 | The process model: typed identifier spaces, `defineModel` with compile-time reference checking, structural validation.                                                                                                                                                                                             |
| [`graph-projection`](packages/core/graph/projection/README.md)                         | Projections of the model into a flowchart, swimlane, state machine and sequence diagram, plus derived hand-offs, and the inverses that turn an edited view into a diff against the model.                                                                                                                          |
| [`graph-domain`](packages/core/graph/domain/README.md)                                 | Reasoning over the model and a run overlay: control graph, illegal cycles, three-valued status, ready set, blocked-by, impact, what-if and critical path.                                                                                                                                                          |
| [`graph-layout`](packages/core/graph/layout/README.md)                                 | Layered layout of a projected flowchart, swimlane or state machine into positions in the model's `views` shape.                                                                                                                                                                                                    |
| [`graph-source-contract`](packages/core/graph/source-contract/README.md)               | The `GraphSource` port as an oRPC contract: versioned, paged and streamed sync of bound activities, participants, transitions and run state, resumable by cursor, typed filters and scope listings, with an in-memory fake and a conformance kit.                                                                  |
| [`graph-source-github-issues`](packages/adapters/graph/source-github-issues/README.md) | The GitHub issues adapter for the `GraphSource` port: issues, `blockedBy` and `blocking`, sub-issues and assignees across organisations, repositories and Projects v2 boards, with server-side filters, a scope listing and per-owner tokens.                                                                      |
| [`graph-store-contract`](packages/core/graph/store-contract/README.md)                 | The persistence port as an oRPC contract: save, load and delete models, set run state and the facts a run reads (provided artefacts, condition values), upsert items and relations from a source, ready, blocked-chain, impact and hierarchy queries, a change feed; with an in-memory fake and a conformance kit. |
| [`graph-sync`](packages/core/graph/sync/README.md)                                     | Syncs `GraphSource`s into a `GraphStore` page by page: participants, bound activities, transitions, relations and run state, resumable from a checkpoint and narrowed by a typed filter; the one sync the command line and the web app share.                                                                      |
| [`graph-store-sqlite`](packages/adapters/graph/store-sqlite/README.md)                 | The store port on SQLite through Drizzle: one table definition, committed drizzle-kit migrations applied the same way in every runtime, recursive SQL for the structural queries, against Drizzle's async SQLite database so any driver plugs in.                                                                  |
| [`graph-sqlite-node`](packages/adapters/graph/sqlite-node/README.md)                   | The SQLite store on Node's built-in `node:sqlite` through `drizzle-orm/node-sqlite`, for the command line and servers.                                                                                                                                                                                             |
| [`graph-sqlite-wasm`](packages/adapters/graph/sqlite-wasm/README.md)                   | The SQLite store in the browser: SQLite wasm in a dedicated worker on OPFS `opfs-sahpool`, shared between tabs under a Web Lock with no special headers, served to the page over oRPC.                                                                                                                             |
| [`graph-react`](packages/ui/graph/react/README.md)                                     | Headless React hooks and unstyled components: follow a stored model, derive statuses, the ready set, blocked chains, impact and explanations, project views, filter, select and navigate by keyboard.                                                                                                              |
| [`graph-ui`](packages/ui/graph/ui/README.md)                                           | Styled components over `graph-react` and an SVG sequence diagram, in Vanilla Extract with a typed theme contract and light and dark themes, shipped as compiled CSS.                                                                                                                                               |
| [`graph-react-flow`](packages/ui/graph/react-flow/README.md)                           | React Flow views of the model: flowchart, swimlane with lanes as group nodes, and state machine, laid out by `graph-layout`, showing each status and the critical path; sequence projections drawn by `graph-ui`.                                                                                                  |
| [`graph-cli`](packages/targets/graph-cli/README.md)                                    | The command line and its library entry: sync GitHub issues into the SQLite store, ready, blocked, impact, critical path, cycles, hand-offs and status explanations, and every view drawn in Mermaid or Graphviz DOT.                                                                                               |

The web app, private and not bundled into `process-graph`:

| Package                                             | What it is                                                                                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`graph-web`](packages/targets/graph-web/README.md) | The web app: an installable, offline-first PWA that syncs GitHub issues into SQLite on the device and shows the work in every view, with what is ready, what is blocked and why, linkable by address. |

## Conventions

- **One instruction file.** This README is also `AGENTS.md` and `CLAUDE.md`, which are symlinks to it, in the root and in every package.
- **Report, never absorb.** Unknown references and cycles are returned as data; an operation that is undefined on a cyclic graph throws an error carrying the cycles.
- **Isomorphic core.** Core packages import nothing Node-only (`isomorphic: true` in the package's lint config), so they run in a browser, a Worker or Node unchanged.
- **Type safety.** No `any`, no `as` outside `as const`, no non-null assertions, no lint suppressions. Narrow `unknown` with `in` and guards.
- **Iterative graph algorithms.** Graph traversals use explicit stacks, so depth is bounded by memory, not the call stack.
- **Evergreen content.** Docs and comments state what things are and why, never counts, sizes or today's data shape.
- **Commits.** Conventional commits, types from `commit-types.ts` (the single source for commitlint and release rules), bodies wrapped at 100 columns, staged by file name.

## Releases

Releases run through [`@exadev/semantic-release-workspace`](https://github.com/ExaDev/semantic-release-workspace), configured in `release-workspace.config.ts` and run by the `release` job in CI. Every package versions independently and is tagged `<name>@<version>`; a package releases when commits touch its own directory, or when a sibling it depends on releases, in dependency order. Only `process-graph` is published, with its own `CHANGELOG.md` and GitHub Release; a private package gets a version and a tag and nothing else. Because `process-graph` lists every package it bundles in `devDependencies`, a change to any of them releases `process-graph` too.

The release commit and tags are pushed to the protected `main` with a repository deploy key (the `RELEASE_DEPLOY_KEY` secret) over SSH, because `GITHUB_TOKEN` cannot bypass a ruleset; the `main` ruleset lists that deploy key as a bypass actor. `GITHUB_TOKEN` is still used for the GitHub API calls that create releases and comment on issues and pull requests.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for adding a package and the release strategy.
