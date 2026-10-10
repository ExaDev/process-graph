# @exadev/process-graph-projection

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/@exadev/process-graph-projection) [![Release](https://img.shields.io/github/v/release/ExaDev/process-graph)](https://github.com/ExaDev/process-graph/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

Projections of the process model from `@exadev/process-graph-schema` into each notation. Every projection is a pure function of the model plus the extra input its notation needs, and none of them reads or preserves layout. `src/` imports nothing Node-only.

| Function                         | Extra input              | Result                                                          |
| -------------------------------- | ------------------------ | --------------------------------------------------------------- |
| `handoffs(model)`                | none                     | Transitions between elements whose actors differ.               |
| `toFlowchart(model)`             | none                     | Nodes (process, decision, terminator, bar) and guarded edges.   |
| `toSwimlane(model)`              | none                     | The flowchart plus lanes by actor, unassigned nodes, hand-offs. |
| `toStateMachine(model, subject)` | a subject entity         | States and transitions with decisions folded into guards.       |
| `toSequence(model, scenario)`    | a path of transition ids | Lifelines in order of first appearance, messages and fragments. |

```ts
import { handoffs, toSequence } from "@exadev/process-graph-projection";

handoffs(model); // [{ transition: "t2", from: "customer", to: "shop" }]
toSequence(model, ["t1", "t2"]);
```

## Hand-offs are derived

A transition between two elements with different actors is a hand-off, never stored. Elements without an actor never produce one. A transition into a `message` element continues through it to the step after it, so a message between two steps is part of the hand-off it carries (listed in `through`), not an end of it.

## Message elements

A `message` element is read by every projection. A sequence step arriving at one draws it with its own `from`, `to`, `label` and `mode`, naming it in `element`, and the step leaving it continues the same message. A flowchart or swimlane has no node for it: the edge from the step before it to the step after it carries it (`through`), labelled with the message unless a step on it is guarded. A state machine folds it the way it folds a decision, and its `event` triggers the transition that carries it. Only a message element that nothing carries is reported as a `message-elements` loss.

Flowchart edges and state machine transitions list the model `transitions` they stand for, and the elements folded into them in `through`, so an edit to them maps back to the model.

Routes through folded elements are collapsed, never enumerated. From each transition leaving a drawn element, a flowchart edge, hand-off or state machine transition is drawn once for each drawn element it leads to, however many routes connect them. Its `transitions` and `through` are the union over those routes, each listed once in the order a depth-first walk in model order first meets them. The walk enters each folded element once per starting transition and follows each transition leaving it once, and each target's union is gathered by walking back once over the transitions met, so the work grows with the elements and transitions reached and the number of targets, never with the number of routes; a transition back to a folded element still on the walk's path closes a cycle and ends there. On a single route the guards are joined with "and" and the last trigger and effect are kept; where several routes are merged their guards, triggers and effects belong to different routes, so a flowchart edge is labelled only with the messages it carries and a state machine transition keeps only the target's entry action.

## Swimlane lanes

`toSwimlane` has a lane for every declared role or system, in declaration order, with empty `nodes` when nothing is assigned to it, so a participant that has not started yet is still visible. Entities are not actors and get no lane. An actor that a runtime model names without declaring still gets a lane, after the declared ones, and `validate` reports it.

## State machine scope

`toStateMachine(model, subject)` keeps the activities whose `affects` lists the subject, plus authored `state` elements and pseudo-states. A step that does not affect the subject is not one of its states: transitions through it are folded into the transition leaving the previous state, the way a decision is, so one model yields a different machine per subject.

When no activity in the model declares `affects`, the model carries no such information and every activity is kept. Once any activity declares it, an activity without `affects` is not kept (an empty list is a declaration that it affects nothing).

## Sequence messages

A step between two elements with actors is a message, labelled by its trigger's event name, or else by its target's label. An element with no actor that the scenario passes through, such as a fork or join, passes on whoever reached it, so the step leaving it is sent by the actor of the step that arrived. A step that still has no sender, or arrives at an element with no actor, draws nothing and is reported as a skipped step.

## Sequence fragments

`toSequence` returns `messages`, the flat list in scenario order, and `items`, the same messages with fragments wrapped around the ones that fall inside them. An item is a `message` or a `fragment` carrying its `operator` and the `operands` the scenario takes, each with its guard and its own items. An authored fragment names itself in `fragment`; a derived one names the decision or fork it comes from in `element`.

Fragments are derived from the model's structure, restricted to the scenario path:

| Structure                                                                   | Fragment | Operands                                |
| --------------------------------------------------------------------------- | -------- | --------------------------------------- |
| A decision's transition whose target can reach the decision again           | `loop`   | One, guarded by that transition's guard |
| A decision's other (forward) branches, when there are at least two          | `alt`    | One per branch, guarded by the branch   |
| Exactly two forward branches, one of them going straight to where they meet | `opt`    | The branch that does something          |
| A fork pseudo-state's branches                                              | `par`    | One per branch                          |

A loop transition is the same one `graph-domain` treats as a legal cycle. A loop's body is every element on a cycle through it; a branch's body is what it reaches, over forward transitions, that not every branch reaches (what every branch reaches lies after they meet). A derived fragment holding exactly the messages of an authored one is not drawn: the authored fragment is the author's notation for the same structure.

A message belongs to an operand when it arrives at an element in that operand's body. A fragment is drawn when at least one operand has a body wholly on the scenario path and receives a message, and its messages are consecutive in the scenario. An operand the scenario does not take is not drawn (an `alt` shows the branch taken, and the other branch is among the `unshown-branches`). A fragment nests inside another when all its messages lie within one of that fragment's operands. One that cannot be drawn faithfully, being interleaved with messages outside it, off the path or overlapping another without nesting, is left out, and an authored one left out is reported as a `fragments` loss.

## Loss reports

Every projection result carries `loss`, what it did not carry over from the model. Each `Loss` is a discriminated union on `kind`, reported only when something was actually dropped, in this order:

| `kind`                   | Dropped                                                                                                                                      | Reported by                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `layout`                 | Positions recorded in `views` for this projection's own notation.                                                                            | every projection                              |
| `extensions`             | Notation-only `extensions` on elements, which no projection shows.                                                                           | every projection                              |
| `message-elements`       | `message` elements the projection neither draws nor folds into an edge or transition.                                                        | every projection                              |
| `fragments`              | Authored fragments the projection does not draw.                                                                                             | every projection                              |
| `unrepresented-elements` | Elements the notation has no way to draw (`state`, `history`, and in a state machine `fork` and `join`), with the transitions touching them. | `toFlowchart`, `toSwimlane`, `toStateMachine` |
| `subject`                | Activities left out because they do not affect the state machine's subject.                                                                  | `toStateMachine`                              |
| `scenario`               | Elements of the model that are not on the scenario.                                                                                          | `toSequence`                                  |
| `unshown-branches`       | Transitions leaving an element on the scenario that the scenario does not take.                                                              | `toSequence`                                  |
| `skipped-steps`          | Scenario steps that touch an element with no actor and so draw no message.                                                                   | `toSequence`                                  |

Decisions a state machine folds into guards are by design and not a loss. A flowchart drops ownership, a state machine needs its subject recorded, and a sequence diagram follows one path, so one model yields a different diagram per scenario.

## Inverses and view edits

Each view has an inverse that takes the view after an edit and returns a `ModelDiff`: the element, transition and event changes the edit implies, matched by identifier. An edit that introduces identifiers the model does not declare works in the open identifier space (`OpenIds`).

| Function                                | Reads                                                       |
| --------------------------------------- | ----------------------------------------------------------- |
| `diffFlowchart(model, edited)`          | Nodes and edges.                                            |
| `diffSwimlane(model, edited)`           | Nodes, edges and which lane each node is in.                |
| `diffStateMachine(model, edited)`       | States and transitions, for the projection's `subject`.     |
| `diffSequence(model, scenario, edited)` | Messages, matched by transition occurrence on the scenario. |

Element changes are `added`, `removed`, `renamed`, `relaned` (another actor's lane) and `readdressed` (a message element between other actors); transition changes are `added`, `removed`, `rewired` (other ends) and `changed` (its `guard`, `trigger` or `effect`); an event can be `renamed`. Every change carries `inferred`, which is true when the view did not determine it and the inverse chose: a new terminator's or bar's role, an edit to a flowchart edge or state machine transition that stands for a chain through folded elements (its later steps are shared with other chains, so removing it or moving its target acts on each step arriving at its end), and almost everything a sequence diagram implies, since it shows one path and not who owns which step. A new sequence message names the element it arrives at in `element`, a new activity owned by its receiver unless that element exists, and leaves from where the latest earlier message to its sender arrived.

`confirmChanges(diff, accept)` marks the inferred changes `accept` chooses as confirmed. `applyModelDiff(model, diff)` returns the changed model and throws `UnconfirmedChangeError` while any change is still inferred; removing an element also takes it out of fragment bodies and recorded positions, and removing a transition takes it out of every scenario. An edit the model cannot express, such as a changed node shape, a relabelled terminator or a lane for an entity, throws instead of being dropped.

```ts
import {
  applyModelDiff,
  confirmChanges,
  diffSequence,
} from "@exadev/process-graph-projection";

const diff = diffSequence(model, scenario, editedDiagram);
const next = applyModelDiff(
  model,
  confirmChanges(diff, () => true),
);
```

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
