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

## Swimlane lanes

`toSwimlane` has a lane for every declared role or system, in declaration order, with empty `nodes` when nothing is assigned to it, so a participant that has not started yet is still visible. Entities are not actors and get no lane. An actor that a runtime model names without declaring still gets a lane, after the declared ones, and `validate` reports it.

## State machine scope

`toStateMachine(model, subject)` keeps the activities whose `affects` lists the subject, plus authored `state` elements and pseudo-states. A step that does not affect the subject is not one of its states: transitions through it are folded into the transition leaving the previous state, the way a decision is, so one model yields a different machine per subject.

When no activity in the model declares `affects`, the model carries no such information and every activity is kept. Once any activity declares it, an activity without `affects` is not kept (an empty list is a declaration that it affects nothing).

## Sequence fragments

`toSequence` returns `messages`, the flat list in scenario order, and `items`, the same messages with the authored `fragments` wrapped around the ones that fall inside them. An item is a `message` or a `fragment` carrying its `operator` and the `operands` the scenario takes, each with its guard and its own items. Fragments are never invented: every one drawn is authored.

A message belongs to an operand when it arrives at an element in that operand's body. A fragment is drawn when at least one operand has a body wholly on the scenario path and receives a message, and its messages are consecutive in the scenario. An operand the scenario does not take is not drawn (an `alt` shows the branch taken, and the other branch is among the `unshown-branches`). A fragment nests inside another when all its messages lie within one of that fragment's operands. One that cannot be drawn faithfully, being interleaved with messages outside it, off the path or overlapping another without nesting, is left out and reported as a `fragments` loss.

## Loss reports

Every projection result carries `loss`, what it did not carry over from the model. Each `Loss` is a discriminated union on `kind`, reported only when something was actually dropped, in this order:

| `kind`             | Dropped                                                                         | Reported by      |
| ------------------ | ------------------------------------------------------------------------------- | ---------------- |
| `layout`           | Positions recorded in `views` for this projection's own notation.               | every projection |
| `extensions`       | Notation-only `extensions` on elements, which no projection shows.              | every projection |
| `message-elements` | `message` elements, which no projection draws.                                  | every projection |
| `fragments`        | Authored fragments the projection does not draw.                                | every projection |
| `subject`          | Activities left out because they do not affect the state machine's subject.     | `toStateMachine` |
| `scenario`         | Elements of the model that are not on the scenario.                             | `toSequence`     |
| `unshown-branches` | Transitions leaving an element on the scenario that the scenario does not take. | `toSequence`     |

A flowchart drops ownership, a state machine needs its subject recorded, and a sequence diagram follows one path, so one model yields a different diagram per scenario.

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
