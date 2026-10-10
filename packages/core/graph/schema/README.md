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

`validate(model)` returns the issues a runtime model can still have: `duplicate-id`, `unknown-reference`, `multiple-initial`, `subject-not-entity`, `actor-is-entity` and `duplicate-source` and `multiple-producers`. An authored model is already reference-safe at compile time; `validate` is for models loaded from JSON and for the rules the type system cannot state.

## Source binding

An activity may carry `source`, a source-qualified identifier such as `github:org/repo#12`, tying it to the external record it stands for. The source is the activity's identity in its system, so two activities may not share one (`duplicate-source`). Activities without a source are unaffected.

## Artefacts

Control flow says what follows what; artefacts say what a step needs and makes. An `ArtefactDef` has an `id`, a `name` and an optional `deliverable` flag, and an activity lists the artefacts it `consumes` and `produces` by identifier. `artefact` is an identifier space like the others, so an undeclared artefact is a compile error.

- An artefact no activity produces is an **input**: the process takes it as given. `inputsOf(model)` lists them.
- An artefact flagged `deliverable` is an **output**: what the process exists to deliver. `outputsOf(model)` lists them.
- An artefact has at most one producer (`multiple-producers`), so "what produces this" has one answer.

## Loading a model

`parseModel(input)` loads a model from untrusted input such as parsed JSON and returns a `Model<OpenIds>`. It checks the shape with `modelSchema` first, so every shape problem is reported with the JSON pointer of the offending value, then runs `validate`. A bad input throws `ModelParseError`, whose `issues` are either `{ source: "schema", pointer, message }` or `{ source: "validate", code, message }`.

### Types and the open schema

The two cover different things on purpose.

- **Types** carry what only an author can get wrong before the model exists: a reference to an undeclared identifier, an identifier of the wrong space, an entity acting. They need the identifiers to be literals, so they only apply to a model written in source.
- **The open schema** carries what a loaded document can get wrong: shape, vocabulary, unknown keys (every object is strict, so a misspelt field is an error and is never dropped), then the rules in `validate`.

`z.infer<typeof modelSchema>` is exactly `Model<OpenIds>`, pinned by a type-level test, so a loaded model is usable anywhere an open-space model is.

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
