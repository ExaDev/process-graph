# @exadev/process-graph-domain

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

A private workspace package, not published on its own: it is bundled into [`process-graph`](../../../targets/process-graph/README.md), which exposes it as its exports at the root entry, `process-graph`.

Reasoning over the process model from `@exadev/process-graph-schema` and a run overlay: which work is ready, what blocks what, what a decision's branches do, which cycles are legal, and what finishing something changes. Pure functions over `Model<I>` and `Overlay<I>`, built on `@exadev/process-graph-dag`. Run state is an input, never part of the model. `src/` imports nothing Node-only.

```ts
import {
  readySet,
  blockedBy,
  deriveStatuses,
} from "@exadev/process-graph-domain";

// The injected source of facts: here, one boolean the model's decision reads.
const facts = (key) =>
  key === "approved"
    ? { found: true, value: { kind: "boolean", value: true } }
    : { found: false };
const overlay = { triage: "done" };

readySet(model, overlay, facts); // ["accept"]
blockedBy(model, overlay, facts, "close"); // ["accept"]
deriveStatuses(model, overlay, facts); // Map { "triage" => "done", ... }
```

## Functions

| Function                                      | Result                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `controlDag(model)`                           | The `graph-dag` `Dag` over element ids, with loop edges removed.                         |
| `loopTransitions(model)`                      | The transitions that close a legal decision loop.                                        |
| `illegalCycles(model)`                        | The cycles of the control graph, each with its path.                                     |
| `evaluateBranches(model, overlay, facts)`     | Each transition's `taken`, `not-taken` or `indeterminate`.                               |
| `deriveStatuses(model, overlay, facts)`       | The `Status` of every element.                                                           |
| `readySet(model, overlay, facts)`             | The elements that are `ready`.                                                           |
| `blockedBy(model, overlay, facts, id)`        | The open leaves an element is waiting on.                                                |
| `impact(model, overlay, facts, id)`           | The live elements that transitively depend on `id`.                                      |
| `explainStatus(model, overlay, facts, id)`    | The rule that decided `id`'s status, what it was decided from, and the blocked-by chain. |
| `whatIfDone(model, overlay, facts, id)`       | The elements that become ready and every status change if `id` were done.                |
| `criticalPath(model, overlay, facts, weight)` | The heaviest chain through the work still ahead.                                         |
| `unmetOutputs(model, overlay, facts)`         | Each deliverable not yet produced, with the elements and missing inputs it still needs.  |

Every function that derives status throws `CycleError` (from `graph-dag`, carrying the cycles) when `illegalCycles` is not empty, `UnknownNodeError` when a transition names an element the model does not declare, and `UnsupportedConditionError` for a condition the facts port cannot serve.

## The control graph

Nodes are element ids. A node needs the sources of its incoming transitions and, for an activity, the producer of every artefact in `consumes`.

A **loop edge** is a transition leaving a `decision` element whose target can reach its source (or is its source), so that it closes a cycle through the decision. Reachability is over the whole graph, transitions and artefact dependencies alike. A loop edge is excluded from `needs`: it is a way back to earlier work, never a prerequisite of it, so readiness is computed on the loop-free graph. An element whose only incoming transitions are loop edges has no needs, and a loop edge's own condition never affects any status.

A cycle that passes through a decision is legal and leaves no cycle behind in the control graph. Any cycle that remains has no decision in it, can never make progress, and is returned by `illegalCycles` as data. A path follows `graph-dag`'s convention: each element needs the next and the last needs the first, repeated at the end, so `["x", "y", "x"]` means x needs y and y needs x.

## Status

Every element has one of five states, derived and never stored.

| Status    | When                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `done`    | The overlay says `done`, or the element is a `decision` or `pseudo` element whose needs are met (see below).                                             |
| `unknown` | The overlay says `unknown`, a transition that is not cut is `unknown` or has an indeterminate condition, or a consumed artefact has an unknown producer. |
| `skipped` | It has incoming transitions and every one is cut.                                                                                                        |
| `ready`   | Every transition that is not cut comes from a `done` source, and every consumed artefact is provided or has a `done` producer.                           |
| `blocked` | Anything else.                                                                                                                                           |

An element with no overlay entry is open. The rules are applied in the order of the table, so `unknown` dominates `blocked`: an element with an unknown need is `unknown` even if another need is still open.

A **transition is cut** when its condition is definitely false or its source is `skipped`. A cut transition is not a need, whatever state its source is in. This is what lets a join be satisfied by a skipped branch: the rule above, applied to a `join` pseudo-state, is exactly "ready only when every incoming source is done or skipped", and a `fork` passes because it adds no condition of its own.

**Control elements are transparent.** A `decision` or `pseudo` element has no work for anyone to do and no source reports it, so when it would be `ready` it is `done`, and downstream elements are not held up by it. They never appear in the ready set. Their `unknown` and `skipped` states apply as for any element. `activity`, `state` and `message` elements are work and stay `ready` until the overlay says they are done.

**Artefacts.** A consumed artefact is satisfied when it is provided (see below) or a producer is `done`. An artefact whose producers are all skipped, or that has no producer and is not provided, is never satisfied, and its consumer is `blocked`.

## Decisions and facts

A transition's `condition` is a trilean `PredicateNode`, evaluated with trilean's synchronous evaluator. A definite true takes the branch (`taken`), a definite false does not (`not-taken`), and an indeterminate result (a fact the port cannot answer) leaves both branches possible: everything downstream is `unknown`, not `blocked` or `skipped`. A transition without a condition is always taken.

The `Facts` port is `(key: JsonValue) => Resolution`: an opaque key in, `{ found: true, value }` or `{ found: false }` out. A condition's `reference` keys reach it unchanged. Two keys are reserved, each an object with a single `$`-prefixed field, and a `Facts` implementation should not use that field.

| Key                    | Answered by                    | Meaning                                                                                                                                                                                         |
| ---------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elementStatusKey(id)` | This package, from the overlay | The text `"done"` or `"open"`. Not found, so indeterminate, when the overlay says `unknown` or `id` is not an element. It reads the overlay, never the derived status, so no cycle is possible. |
| `artefactKey(id)`      | The port: the package asks it  | The boolean `true` when the input artefact is provided. Not found or `false` means it is not.                                                                                                   |

`lookup`, `some`, `every` and fold conditions need tables or collections, which the port does not serve; they throw `UnsupportedConditionError` rather than being read as an empty collection.

## Queries

`blockedBy` starts at an element's unfinished needs and follows each one's own unfinished needs to the elements that wait on nothing further: the minimal set of open work to finish first. Cut transitions and provided artefacts are not followed. An element that is not blocked by anything returns an empty list, and so does an element that is `done` or `skipped`, even one the overlay marked done ahead of its needs.

`explainStatus` says why an element has its status. `rule` names the rule of the status table that decided it (`overlay-done`, `overlay-unknown`, `unknown-need`, `all-cut`, `needs-met` or `waiting`); `transitions` lists its incoming transitions other than loop edges, each with its branch, its source's status and whether it is cut; `artefacts` lists what it consumes, each with whether it is provided and its producers' statuses. `chain` is the blocked-by chain: the element, then every unfinished need reached from it, each with the needs it still waits on, so the links after the first that wait on nothing are exactly what `blockedBy` returns. The explanation is recorded by the derivation itself, so it never disagrees with `deriveStatuses`.

`impact` follows live needs in reverse, so a branch that was not taken, a skipped element and an element already `done` carry no impact; `id` itself is not included.

`whatIfDone` derives the run again with `id` marked `done`, without mutating anything. `becomesReady` lists the elements that were not ready and are; `changes` lists every status that moved, in model order.

`criticalPath` runs `graph-dag`'s `criticalPath` over the live elements (neither `done` nor `skipped`), ordered by the live needs among them. Its tie-breaking rule holds: the earliest element in model order wins.

`unmetOutputs` reports each `deliverable` artefact that is not provided and has no `done` producer. `needed` is its unfinished producers and, transitively, everything those wait on; `missingInputs` is the artefacts among their consumed ones that no activity produces and the port does not report as provided.

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
