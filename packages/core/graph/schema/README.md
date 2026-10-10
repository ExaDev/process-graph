# @exadev/process-graph-schema

The process model: one layout-free description of a process that a flowchart, a swimlane, a state machine and a sequence diagram are all views of. Participants, events, actions, elements, transitions and fragments are declared once and cross-referenced by identifier. `src/` imports nothing Node-only and runs unchanged in a browser or a Worker.

```ts
import { defineModel, validate } from "@exadev/process-graph-schema";

const model = defineModel({
  participants: [
    { id: "customer", label: "Customer", kind: "role" },
    { id: "shop", label: "Shop", kind: "system" },
  ],
  events: [],
  actions: [],
  elements: [
    { kind: "pseudo", id: "start", role: "initial" },
    {
      kind: "activity",
      id: "submit",
      label: "Submit order",
      actor: "customer",
    },
    { kind: "activity", id: "pack", label: "Pack", actor: "shop" },
  ],
  transitions: [
    { id: "t1", source: "start", target: "submit" },
    { id: "t2", source: "submit", target: "pack" },
  ],
  fragments: [],
  projections: [],
});

validate(model); // []
```

## Typed identifier spaces

Each kind of thing that can be referenced has its own string-literal union, inferred by `defineModel` from the declaring arrays only. A reference to an identifier that was never declared, or an identifier of one kind used where another is expected, is a compile error.

| Space                                                  | Holds                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `participant`                                          | Every declared participant.                                        |
| `actor`                                                | Participants of kind `role` or `system`: the ones that can act.    |
| `entity`                                               | Participants of kind `entity`: the ones a state machine can track. |
| `event`, `action`, `element`, `transition`, `fragment` | Their own declarations.                                            |

An activity's actor and a message's ends must be actors; a state machine projection's subject must be an entity. Naming a participant of the wrong kind is a compile error too. `OpenIds` is the space whose members are all plain `string`, for models whose identifiers are only known at runtime.

## What the types cannot say

`validate(model)` returns the issues a runtime model can still have: `duplicate-id`, `unknown-reference`, `multiple-initial`, `subject-not-entity` and `actor-is-entity`. An authored model is already reference-safe at compile time; `validate` is for models loaded from JSON and for the rules the type system cannot state.

## Layout

Layout is not part of the model's meaning. `views` holds optional positions keyed by element identifier and notation, so a projection never has to preserve or read coordinates.

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests, including the compile-fail checks
pnpm typecheck      # also fails when an expected compile error stops failing
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
