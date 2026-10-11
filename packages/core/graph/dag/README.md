# @exadev/process-graph-dag

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

A private workspace package, not published on its own: it is bundled into [`process-graph`](../../../targets/process-graph/README.md), which exposes it as the `dag` namespace of the root entry, `process-graph`.

Dependency-graph primitives over any node set and a `needs` accessor: topological layers, ancestors, descendants, cycle detection, transitive reduction and the critical path. No runtime dependencies, no knowledge of any process model, and no recursion, so a deep graph cannot overflow the call stack. `src/` imports nothing Node-only and runs unchanged in a browser or a Worker.

A graph is built once from the data you already have, then analysed with plain functions:

```ts
import {
  buildDag,
  criticalPath,
  findCycles,
  topologicalLayers,
} from "@exadev/process-graph-dag";

const jobs: Record<string, string[]> = {
  build: [],
  lint: [],
  test: ["build"],
  release: ["test", "lint"],
};

const dag = buildDag(Object.keys(jobs), (id) => jobs[id] ?? []);

topologicalLayers(dag).layers; // [["build", "lint"], ["test"], ["release"]]
findCycles(dag); // []
criticalPath(dag, () => 1); // { path: ["build", "test", "release"], weight: 3 }
```

## Model

Ids are `string | number`, so two ids name the same node exactly when they are strictly equal. `needs(id)` lists the nodes that must come before `id`. Every ordering this package produces derives from the order `nodes` was iterated in, so results are deterministic and stable.

Nothing is absorbed silently:

- **Unknown references.** A `needs` target that is not a node is not an edge. It is returned as data in `dag.unknownReferences`, one `{ from, missing }` per distinct pair.
- **Cycles.** `buildDag` never throws for a cycle. `findCycles` reports them with their paths, and each analysis states below what it does when one exists.
- **Duplicates.** Repeated nodes and repeated needs collapse to their first occurrence. A node that needs itself keeps that edge and is a cycle of one.

## API

| Function                           | Returns                                                                                             | With a cycle                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `buildDag(nodes, needs)`           | An immutable `Dag`: nodes, needs, dependents, unknown references                                    | Builds normally.                                                                       |
| `topologicalLayers(dag)`           | `levels`, `layers`, `unlayered`                                                                     | Layers the acyclic part; nodes on a cycle or needing one are returned in `unlayered`.  |
| `ancestorsOf(dag, id)`             | Transitive needs, in node order                                                                     | Includes `id` itself when it is on a cycle.                                            |
| `descendantsOf(dag, id)`           | Transitive dependents, in node order                                                                | Includes `id` itself when it is on a cycle.                                            |
| `findCycles(dag)`                  | One closed path per cyclic strongly connected component                                             | Not applicable; this is the report.                                                    |
| `stronglyConnectedComponents(dag)` | Every strongly connected component, each node in exactly one, a component before those that need it | Not applicable; a cycle is a component of several nodes or of one node needing itself. |
| `immediateDominators(dag, root)`   | Each node reachable from `root` along `needs` mapped to its immediate dominator                     | Allowed; dominance is defined on any graph.                                            |
| `transitiveReduction(dag)`         | A `Dag` without redundant edges                                                                     | Throws `CycleError`: with a cycle the reduction is not unique.                         |
| `criticalPath(dag, weight)`        | `{ path, weight }`, the heaviest chain                                                              | Throws `CycleError`: a chain through a cycle has no greatest weight.                   |

`ancestorsOf` and `descendantsOf` throw `UnknownNodeError` for an id that is not a node. `criticalPath` throws `RangeError` for a negative or non-finite weight.

### Layers

A node's level is the length of the longest `needs` chain below it: a node with no needs is level 0, every other node is one more than its highest-level need. `layers[n]` holds the level-n nodes in node order; each needs only earlier layers, so a layer can run in parallel once the previous ones are done. Unknown references contribute nothing to a level.

### Cycles

`findCycles` returns one path per strongly connected component that contains a cycle (more than one node, or a self-loop). A path lists nodes so that each needs the next and the last needs the first, repeated at the end: `["a", "b", "c", "a"]` means a needs b, b needs c and c needs a. A self-loop is `["a", "a"]`.

Which cycle is reported for a component is fixed: a shortest cycle through the component's first node in node order, ties going to the earliest needs. Paths are ordered by the position of their first node. A component may hold more cycles than the one reported; break the reported one and call again to find the rest.

### Transitive reduction

An edge from a node to one of its needs is redundant when another of its needs already depends on that need. The reduction removes every redundant edge, keeps each node's remaining needs in their original order, and has the same ancestors and descendants as the input. Unknown references pass through unchanged.

### Critical path

The path with the greatest total node weight along `needs`, returned in dependency order. `weight(id)` is called once per node, in node order. The path always runs back to a node with no needs. Ties are broken by node order: among equally heavy needs the earliest node is followed, and among equally heavy end nodes the earliest ends the path. An empty graph returns `{ path: [], weight: 0 }`.

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
