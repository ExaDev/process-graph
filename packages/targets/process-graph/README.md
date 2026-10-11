# process-graph

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/process-graph) [![Release](https://img.shields.io/github/v/release/ExaDev/process-graph)](https://github.com/ExaDev/process-graph/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

The one install for the process-graph model: a layout-free description of a process, its projections into a flowchart, a swimlane, a state machine and a sequence diagram, and reasoning over a run (what is ready, what blocks what, what finishing something changes). Layout, the GitHub issues source, the SQLite store for Node and the browser, the React UI and the command line each sit behind a subpath of their own, so an application loads only the parts it imports. ESM only.

```ts
import {
  defineModel,
  deriveStatuses,
  toSwimlane,
  type Facts,
} from "process-graph";

const model = defineModel({
  participants: [
    { id: "customer", label: "Customer", kind: "role" },
    { id: "shop", label: "Shop", kind: "system" },
  ],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "submit", label: "Submit", actor: "customer" },
    { kind: "activity", id: "pack", label: "Pack", actor: "shop" },
  ],
  transitions: [{ id: "t1", source: "submit", target: "pack" }],
  fragments: [],
  projections: [],
});

// The injected source of facts a decision's condition reads; this model has no decisions.
const facts: Facts = () => ({ found: false });

toSwimlane(model).lanes; // one lane per actor, each with the elements it owns
deriveStatuses(model, { submit: "done" }, facts); // Map { "submit" => "done", "pack" => "ready" }
```

## Subpaths

The package is built from the repository's internal packages, which are bundled into it and not published on their own; each internal package's README documents its functions and rules. Each subpath loads only the code it reaches.

| Import                               | What it is                                                                                                                                                                         | Runs in               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `process-graph`                      | The model (`defineModel`, `parseModel`, `validate`), its projections and inverses, and the reasoning over a run (statuses, ready set, blocked-by, impact, what-if, critical path). | Browser, Worker, Node |
| `process-graph/layout`               | `layout`: positions for a projected flowchart, swimlane or state machine, in the model's `views` shape, through elkjs.                                                             | Browser, Worker, Node |
| `process-graph/source/github`        | The `GraphSource` port (contract, schemas, router, pagination and an in-memory fake) and the GitHub issues adapter, `createGitHubIssuesSource`.                                    | Browser, Worker, Node |
| `process-graph/source/github/node`   | `githubTokenFromEnvironment`: a token port reading `GITHUB_TOKEN` or the GitHub CLI's token.                                                                                       | Node                  |
| `process-graph/store`                | The `GraphStore` port (contract, schemas, router, change feed, structural queries and an in-memory fake) and the SQLite store over any Drizzle SQLite database.                    | Browser, Worker, Node |
| `process-graph/store/node`           | `openNodeGraphStore`: the SQLite store on Node's built-in `node:sqlite`.                                                                                                           | Node                  |
| `process-graph/store/wasm`           | `connectGraphStore`: connects a page to the store a dedicated worker serves.                                                                                                       | Browser               |
| `process-graph/store/wasm/worker`    | `serveGraphStoreInWorker`: serves the store from a dedicated worker on SQLite wasm and OPFS, shared between tabs with no special headers.                                          | Dedicated worker      |
| `process-graph/react`                | Headless React hooks and unstyled components: follow a stored model, derive its run, project, filter and select.                                                                   | Browser               |
| `process-graph/ui`                   | Styled components over `process-graph/react`, the SVG sequence diagram and the theme contract with light and dark themes.                                                          | Browser               |
| `process-graph/ui/style.css`         | The compiled styles for `process-graph/ui`.                                                                                                                                        | Browser               |
| `process-graph/react-flow`           | React Flow views of a flowchart, swimlane or state machine, laid out by `process-graph/layout`.                                                                                    | Browser               |
| `process-graph/react-flow/style.css` | The compiled styles for `process-graph/react-flow`, React Flow's own included.                                                                                                     | Browser               |
| `process-graph/cli`                  | The command line as a library: `runCli` over injected ports, `nodePorts` for a Node process, and each command's operation returning plain data.                                    | Node                  |

`zod` and `trilean`, which the root entry needs, are dependencies. The libraries only other subpaths need are optional peer dependencies, so installing `process-graph` for its root entry pulls in nothing else; install the peers of each subpath you import beside it:

| Subpath             | Peer dependencies                                                            |
| ------------------- | ---------------------------------------------------------------------------- |
| `layout`            | `elkjs`                                                                      |
| `source/github`     | `@orpc/client`, `@orpc/contract`, `@orpc/server`                             |
| `store`             | `@orpc/contract`, `@orpc/server`, `drizzle-orm`                              |
| `store/node`        | `drizzle-orm`                                                                |
| `store/wasm`        | `@orpc/client`                                                               |
| `store/wasm/worker` | `@orpc/contract`, `@orpc/server`, `drizzle-orm`, `@sqlite.org/sqlite-wasm`   |
| `react`             | `react`                                                                      |
| `ui`                | `react`, `@vanilla-extract/recipes`, `@vanilla-extract/css` (types)          |
| `react-flow`        | `react`, `react-dom`, `@xyflow/react`, `elkjs`, `@vanilla-extract/recipes`   |
| `cli` and the bin   | `commander`, `@orpc/client`, `@orpc/contract`, `@orpc/server`, `drizzle-orm` |

The versions are the ones `package.json` declares under `peerDependencies`.

With Vite, exclude `@sqlite.org/sqlite-wasm` from dependency pre-bundling (`optimizeDeps.exclude`), since it loads its `.wasm` file relative to itself. A worker module serving the browser store is one call:

```ts
// store.worker.ts
import { serveGraphStoreInWorker } from "process-graph/store/wasm/worker";

serveGraphStoreInWorker({ name: "graph" });
```

```ts
// in the page
import { connectGraphStore } from "process-graph/store/wasm";

const store = connectGraphStore(
  new Worker(new URL("./store.worker.ts", import.meta.url), { type: "module" }),
);
```

The styled components need their stylesheets imported once:

```tsx
import "process-graph/ui/style.css";
import "process-graph/react-flow/style.css";
import { GraphTheme } from "process-graph/ui";
import { ProcessView } from "process-graph/react-flow";
```

## The command line

The package carries the `process-graph` bin: sync work from GitHub issues into a SQLite store, ask what is ready, blocked, affected, on the critical path or handed off, explain a status, and draw the model in Mermaid or Graphviz DOT. Its peers are installed beside it:

```sh
npm install --global process-graph commander @orpc/client @orpc/contract @orpc/server drizzle-orm
process-graph sync github:ExaDev
process-graph ready
process-graph why github:ExaDev/process-graph#12
process-graph show --view swimlane --format mermaid
```

Run without them, the bin starts nothing: it names the missing peers and the command that installs them with the package manager that ran it, and exits with status 6. Every command, its options and its exit statuses are in the [command line's README](../graph-cli/README.md). A program that mounts the command line as a subcommand, or wants each command's result as data, imports `process-graph/cli`.

## What is exported, and under which name

The root entry exports the model, projection and domain layers flat, under their own names, and the DAG layer as the namespace `dag`, in its entirety: `dag.buildDag`, `dag.topologicalLayers`, `dag.criticalPath`, `dag.CycleError` and the rest. The DAG layer is namespaced because its `criticalPath` has the same name as the domain's, which answers a different question (the heaviest chain through the work still ahead of a run, not through a bare node set). The whole layer is namespaced rather than only the colliding name, so a name added to a layer later cannot start colliding silently.

- A name is never shadowed. Two layers exporting the same name on one entry point is a compile error, and the unit tests compare each entry point's runtime exports with the layers it carries.
- Types follow the same rule as values: a model, projection or domain type is a flat import, a DAG type is `dag.Dag` and so on.
- Errors thrown by the domain functions (`CycleError`, `UnknownNodeError`) are the DAG layer's, so a handler imports them from `dag`.
- The headless and styled components share names (`ElementCard`, `DetailPanel` and others), which is why `process-graph/react` and `process-graph/ui` are separate subpaths.

```ts
import { criticalPath, dag } from "process-graph";

criticalPath; // the domain function: over a model and a run overlay
dag.criticalPath; // the DAG function: over a node set and a `needs` accessor
```

## Commands

```sh
pnpm build             # tsdown: the bundle in dist/, declarations included, with each internal package inlined
pnpm test              # unit tests
pnpm test:smoke        # packs the package, installs the tarball into a throwaway project, imports every subpath and runs the bin
pnpm test:integration  # the bundled browser store in Chromium, against the store contract's conformance kit
pnpm test:mutation     # Stryker
```
