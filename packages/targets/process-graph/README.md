# process-graph

The one install for the process-graph model: a layout-free description of a process, its projections into a flowchart, a swimlane, a state machine and a sequence diagram, and reasoning over a run (what is ready, what blocks what, what finishing something changes). It re-exports the building-block packages so a consumer depends on one package and imports from one place. `src/` imports nothing Node-only and runs unchanged in a browser or a Worker.

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

## This package or a building block

Install `process-graph` to author, load, project and reason about a model. Install a building-block package instead when only one layer is needed and the rest should stay out of the dependency tree, or when another package of this repository imports a layer directly.

| Layer      | Package                            | Exported by this package |
| ---------- | ---------------------------------- | ------------------------ |
| Model      | `@exadev/process-graph-schema`     | flat                     |
| Projection | `@exadev/process-graph-projection` | flat                     |
| Domain     | `@exadev/process-graph-domain`     | flat                     |
| DAG        | `@exadev/process-graph-dag`        | namespaced as `dag`      |

Each package's own README documents its functions and rules; this package adds no behaviour of its own.

## What is exported, and under which name

The model, projection and domain packages are exported flat, under their own names. The DAG package is exported as the namespace `dag`, in its entirety: `dag.buildDag`, `dag.topologicalLayers`, `dag.criticalPath`, `dag.CycleError` and the rest. It is the only layer namespaced, because its `criticalPath` has the same name as the domain package's, which answers a different question (the heaviest chain through the work still ahead of a run, not through a bare node set). The whole layer is namespaced rather than only the colliding name, so a name added to a layer later cannot start colliding silently.

- A name is never shadowed. Two flat layers exporting the same name is a compile error in this package, and its unit test also compares the runtime exports of each package against the entry point's.
- Types follow the same rule as values: a model, projection or domain type is a flat import, a DAG type is `dag.Dag` and so on.
- Errors thrown by the domain functions (`CycleError`, `UnknownNodeError`) are the DAG package's, so a handler imports them from `dag`.

```ts
import { criticalPath, dag } from "process-graph";

criticalPath; // the domain function: over a model and a run overlay
dag.criticalPath; // the DAG function: over a node set and a `needs` accessor
```

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
