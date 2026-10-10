# @exadev/process-graph-projection

Projections of the process model from `@exadev/process-graph-schema` into each notation. Every projection is a pure function of the model plus the extra input its notation needs, and none of them reads or preserves layout. `src/` imports nothing Node-only.

| Function                         | Extra input              | Result                                                          |
| -------------------------------- | ------------------------ | --------------------------------------------------------------- |
| `handoffs(model)`                | none                     | Transitions between elements whose actors differ.               |
| `toFlowchart(model)`             | none                     | Nodes (process, decision, terminator, bar) and guarded edges.   |
| `toSwimlane(model)`              | none                     | The flowchart plus lanes by actor, unassigned nodes, hand-offs. |
| `toStateMachine(model, subject)` | a subject entity         | States and transitions with decisions folded into guards.       |
| `toSequence(model, scenario)`    | a path of transition ids | Lifelines in order of first appearance and messages.            |

```ts
import { handoffs, toSequence } from "@exadev/process-graph-projection";

handoffs(model); // [{ transition: "t2", from: "customer", to: "shop" }]
toSequence(model, ["t1", "t2"]);
```

## Hand-offs are derived

A transition between two elements with different actors is a hand-off, never stored. Elements without an actor never produce one.

## Lossy directions

A flowchart drops ownership, a state machine needs its subject recorded, and a sequence diagram follows one path, so one model yields a different diagram per scenario. Branches off the scenario are not drawn.

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
