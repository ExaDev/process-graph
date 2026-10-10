# @exadev/process-graph-store-contract

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/@exadev/process-graph-store-contract) [![Release](https://img.shields.io/github/v/release/ExaDev/process-graph)](https://github.com/ExaDev/process-graph/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

The persistence port for process models and their run overlays, as an [oRPC](https://orpc.dev) router contract. One definition runs in process (a router client called directly), across a `MessagePort` to a worker, or over HTTP, with no change to its consumers. Inputs and outputs are Zod schemas built from `@exadev/process-graph-schema`'s `modelSchema` and `overlaySchema`, so the port carries the model as it is and storage layout never reaches it. `src/` imports nothing Node-only.

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

| Procedure            | Input                         | Output                                    |
| -------------------- | ----------------------------- | ----------------------------------------- |
| `models.list`        | none                          | Each model's id and revision, by id       |
| `models.save`        | `modelId`, `model`            | The revision the save took                |
| `models.load`        | `modelId`                     | `modelId`, `revision`, `model`, `overlay` |
| `models.delete`      | `modelId`                     | Whether there was a model to delete       |
| `overlay.set`        | `modelId`, `overlay`          | The revision the change took              |
| `items.upsert`       | `modelId`, `items`            | The revision the change took              |
| `query.ready`        | `modelId`                     | The ready elements, in model order        |
| `query.blockedChain` | `modelId`, `element`          | The unfinished work upstream              |
| `query.impact`       | `modelId`, `element`          | The unfinished work downstream            |
| `changes`            | `modelId`, optionally `since` | An event iterator of changes              |

Every call takes the caller's abort signal through the oRPC client options. Failures are the contract's typed errors: `NOT_FOUND` (with `modelId`, and `element` for a query about an element the model lacks) and `UNPROCESSABLE_CONTENT` (with the `issues` that `validate` and `validateOverlay` report). Input that does not match the schemas is oRPC's `BAD_REQUEST`.

## Writes

Every write is atomic and checked: a change that would leave the model invalid, or the overlay naming an element the model does not declare, is rejected whole and the store is unchanged. A write whose signal has fired before it commits changes nothing.

- `models.save` replaces the model and keeps the run state only of elements the new model still declares.
- `overlay.set` sets the run state of the elements it names and leaves the others.
- `items.upsert` merges items read from a source: participants, bound activities and transitions replace the record with the same id in its place, or are appended in their given order; overlay entries replace the run state of the elements they name. It creates the model from an empty one when there is none. A bound activity's `source` is required and equals its id.

Each write takes the next revision from one store-wide sequence, so revisions only grow, a model's revision is the revision of its last change, and a model deleted and saved again never reuses an earlier one.

## Queries

The queries are structural: they read the stored transitions and run state, and nothing else, so a store can answer them in its own query language without loading the model or evaluating anything. For reasoning that follows conditions, artefacts and three-valued status, load the model and use `@exadev/process-graph-domain`.

- Transitions that close a legal decision loop (`loopTransitions` from `graph-domain`) are not dependencies.
- Decisions and pseudo-states are control elements: traversals pass through them and never report them.
- An element is done when its run state is `done`. Traversal stops at a done element and never reports it.
- `query.ready` is every element whose run state is absent or `open`, that is not a control element, and whose blocked chain is empty. On a model with no conditions and no artefacts it agrees with `graph-domain`'s `readySet`.
- `query.blockedChain` is everything not done upstream of the element, each with the fewest transitions to reach it, ordered by that distance and then by model order. A done element waits on nothing.
- `query.impact` is the same downstream, whatever the element's own state.

## Changes

`changes` yields every later change to one model as `{ modelId, kind, revision }`, with `kind` one of `saved`, `overlay`, `items` or `deleted`. The router subscribes before it returns, so a caller holding the iterator is already subscribed and misses nothing it writes next. Given `since`, a revision the caller last saw, the first event is `{ modelId, kind: "missed" }` when the model is no longer at that revision (it changed, or it has gone), and the caller should load it again.

A store's `ChangeFeed` only sees the writes made through that store. Where several processes or tabs write one database, each bridges the others' changes into its own feed.

## Implementing a store

An adapter implements `GraphStore` (plain async functions taking a request object with the abort signal) and serves it with `createGraphStoreRouter`, which owns abort handling, error mapping and subscriptions. `checkStored`, `mergeBoundItems` and `overlayWithin` give every store the same write rules, and `structureOf`, `readyOf`, `blockedChainOf` and `impactOf` are the reference queries `createFakeGraphStore` uses.

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
