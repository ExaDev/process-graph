# @exadev/process-graph-store-contract

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

A private workspace package, not published on its own: it is bundled into [`process-graph`](../../../targets/process-graph/README.md), which exposes it as `process-graph/store`, beside the SQLite store.

The persistence port for process models, their run overlays and the facts known about each run, as an [oRPC](https://orpc.dev) router contract. One definition runs in process (a router client called directly), across a `MessagePort` to a worker, or over HTTP, with no change to its consumers. Inputs and outputs are Zod schemas built from `@exadev/process-graph-schema`'s `modelSchema` and `overlaySchema`, so the port carries the model as it is and storage layout never reaches it. `src/` imports nothing Node-only.

```ts
import { createRouterClient } from "@orpc/server";
import {
  createFakeGraphStore,
  createGraphStoreRouter,
} from "@exadev/process-graph-store-contract";

const store = createRouterClient(
  createGraphStoreRouter(createFakeGraphStore()),
);

await store.v1.models.save({ modelId: "release", model });
await store.v1.overlay.set({ modelId: "release", overlay: { plan: "done" } });
await store.v1.query.ready({ modelId: "release" }); // { elements: ["build"] }

for await (const change of await store.v1.changes({ modelId: "release" })) {
  // { modelId: "release", kind: "overlay", revision: 3 }
}
```

## Procedures

The contract is keyed by version: `graphStoreContract.v1`. A breaking change adds a `v2` beside it, so one server serves both while clients move across.

| Procedure            | Input                         | Output                                             |
| -------------------- | ----------------------------- | -------------------------------------------------- |
| `models.list`        | none                          | Each model's id and revision, by id                |
| `models.save`        | `modelId`, `model`            | The revision the save took                         |
| `models.load`        | `modelId`                     | `modelId`, `revision`, `model`, `overlay`, `facts` |
| `models.delete`      | `modelId`                     | Whether there was a model to delete                |
| `overlay.set`        | `modelId`, `overlay`          | The revision the change took                       |
| `facts.read`         | `modelId`                     | `modelId`, `revision`, `facts`                     |
| `facts.set`          | `modelId`, `facts`            | The revision the change took                       |
| `facts.clear`        | `modelId`, `facts`            | The revision the change took                       |
| `items.upsert`       | `modelId`, `items`            | The revision the change took                       |
| `relations.list`     | `modelId`                     | The relations kept beside the model                |
| `query.ready`        | `modelId`                     | The ready elements, in model order                 |
| `query.blockedChain` | `modelId`, `element`          | The unfinished work upstream                       |
| `query.impact`       | `modelId`, `element`          | The unfinished work downstream                     |
| `query.children`     | `modelId`, `element`          | The element's direct children                      |
| `query.descendants`  | `modelId`, `element`          | Everything beneath it, nearest first               |
| `query.ancestors`    | `modelId`, `element`          | Everything above it, nearest first                 |
| `changes`            | `modelId`, optionally `since` | An event iterator of changes                       |

Every call takes the caller's abort signal through the oRPC client options. Failures are the contract's typed errors: `NOT_FOUND` (with `modelId`, and `element` for a query about an element the model lacks) and `UNPROCESSABLE_CONTENT` (with the `issues` that `validate` and `validateOverlay` report). Input that does not match the schemas is oRPC's `BAD_REQUEST`.

## Writes

Every write is atomic and checked: a change that would leave the model invalid, or the overlay naming an element the model does not declare, is rejected whole and the store is unchanged. A write whose signal has fired before it commits changes nothing.

- `models.save` replaces the model and keeps the run state only of elements the new model still declares, the relations only of what it still declares, and the facts about artefacts only of those it still declares. Named facts are kept.
- `overlay.set` sets the run state of the elements it names and leaves the others.
- `facts.set` records each artefact's provision and each named fact's value it gives, and keeps the rest; `facts.clear` forgets the artefacts and named facts it lists, or the whole record with `{ all: true }`.
- `items.upsert` merges items read from a source: participants, bound activities and transitions replace the record with the same id in its place, or are appended in their given order; overlay entries replace the run state of the elements they name; each relation not already stored is appended. It creates the model from an empty one when there is none. A bound activity's `source` is required and equals its id.

## Relations

A relation is a structural link the model has no field for, kept beside it: `child-of` from a sub-task element to its parent element, `assigned-to` from an element to a person participant, and `part-of` from one participant to the participant that contains it. These are the relations a `GraphSource` reports, so a sync's `relations` go straight into `items.upsert`. A relation is identified by its kind and its two ends, and is stored once however often it is sent. Each end must name what the model declares in the space its kind requires, or the write is rejected whole with an `unknown-reference` issue. Relations carry no ordering: the dependency queries never read them, so a parent does not wait on its children unless a transition says so.

## Facts

A model's fact record is what is known from outside the process about its run, kept beside the overlay: graph-domain's `FactRecord`. `artefacts` maps an artefact id to `true` when it is provided and `false` when it is known not to be; `values` maps a fact's name, the string key a condition's `reference` node gives, to its trilean value (`boolean`, `number`, `text`, `instant`, `duration` or `complex`). Whatever the record does not name is unknown, so the three states of an artefact are provided, absent and unknown, and a named fact is unknown until it is set and again once it is cleared. Each artefact named must be one the model declares, or the write is rejected whole with an `unknown-reference` issue; a fact's name is free. graph-domain's `factsFrom` adapts the record to the `Facts` port, so a consumer loads the model and reasons over `deriveStatuses(model, overlay, factsFrom(facts))`. A model deleted and saved again starts with no facts.

Each write takes the next revision from one store-wide sequence, so revisions only grow, a model's revision is the revision of its last change, and a model deleted and saved again never reuses an earlier one.

## Queries

The queries are structural: they read the stored transitions and run state, and nothing else (not the facts), so a store can answer them in its own query language without loading the model or evaluating anything. For reasoning that follows conditions, artefacts and three-valued status, load the model and use `@exadev/process-graph-domain`.

- Transitions that close a legal decision loop (`loopTransitions` from `graph-domain`) are not dependencies.
- Decisions and pseudo-states are control elements: traversals pass through them and never report them.
- An element is done when its run state is `done`. Traversal stops at a done element and never reports it.
- `query.ready` is every element whose run state is absent or `open`, that is not a control element, and whose blocked chain is empty. On a model with no conditions and no artefacts it agrees with `graph-domain`'s `readySet`.
- `query.blockedChain` is everything not done upstream of the element, each with the fewest transitions to reach it, ordered by that distance and then by model order. A done element waits on nothing.
- `query.impact` is the same downstream, whatever the element's own state.
- `query.children` is every element related to the element by `child-of`, in model order. `query.descendants` and `query.ancestors` walk `child-of` relations down and up from it, each element reported once with the fewest relations it takes to reach it, ordered by that distance and then by model order. The walks never report the element asked about, so they end on a cycle of `child-of` relations, and they read run state not at all.

## Changes

`changes` yields every later change to one model as `{ modelId, kind, revision }`, with `kind` one of `saved`, `overlay`, `items`, `facts` or `deleted`. The router subscribes before it returns, so a caller holding the iterator is already subscribed and misses nothing it writes next. Given `since`, a revision the caller last saw, the first event is `{ modelId, kind: "missed" }` when the model is no longer at that revision (it changed, or it has gone), and the caller should load it again.

A subscription's memory is bounded. A change that commits while the subscriber is waiting goes straight to it; one that commits while the subscriber is busy is held, up to the subscription's capacity. When a change arrives and the subscription already holds that many, the held changes are replaced by one `{ modelId, kind: "missed" }`, and later changes follow it in order. A subscriber that keeps reading therefore misses nothing, and one that stops reading costs the store a fixed amount of memory and learns that it must load the model again. The capacity is a `ChangeFeed` option (`new ChangeFeed({ capacity })`, or `subscribe(modelId, { capacity })` for one subscription); the default, `defaultSubscriptionCapacity`, holds one change, because the only thing a change asks of a subscriber is to read the model again, and the model it reads after one pending change already reflects every later one. The conformance kit checks that a subscriber that stops reading under sustained writes is told it missed whatever it did not receive.

A store's `ChangeFeed` only sees the writes made through that store. Where several processes or tabs write one database, each bridges the others' changes into its own feed.

## Implementing a store

An adapter implements `GraphStore` (plain async functions taking a request object with the abort signal) and serves it with `createGraphStoreRouter`, which owns abort handling, error mapping and subscriptions. `checkStored`, `mergeBoundItems`, `overlayWithin`, `mergeRelations`, `relationsWithin`, `relationIssues`, `mergeFacts`, `withoutFacts`, `factsWithin` and `factIssues` give every store the same write rules, and `structureOf`, `readyOf`, `blockedChainOf`, `impactOf`, `childrenOf`, `descendantsOf` and `ancestorsOf` are the reference queries `createFakeGraphStore` uses.

Every adapter runs the conformance kit, through a real oRPC client:

```ts
import { createRouterClient } from "@orpc/server";
import { graphStoreConformance } from "@exadev/process-graph-store-contract/conformance";

graphStoreConformance({
  name: "my store, in process",
  createClient: async () => ({
    client: createRouterClient(createGraphStoreRouter(await openEmptyStore())),
    close: () => Promise.resolve(),
  }),
});
```

The kit is a separate entry point with an optional `vitest` peer dependency, so the runtime entry carries no test framework. Run it over each transport the adapter is served on; this package runs it against the fake both in process and over a `MessageChannel`.

oRPC clients are proxies over functions, so a procedure named `apply`, `call` or `bind` would be shadowed by `Function.prototype` on the client; the contract avoids those names.
