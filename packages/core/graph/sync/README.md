# @exadev/process-graph-sync

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

A private workspace package, not published on its own: it is bundled into [`process-graph`](../../../targets/process-graph/README.md), which exposes it as `process-graph/sync`.

Syncs work from `GraphSource`s ([`graph-source-contract`](../source-contract/README.md)) into a `GraphStore` ([`graph-store-contract`](../store-contract/README.md)). The command line's `sync` and the web app's sync both call it, so a sync is written the same way wherever it runs. `src/` imports nothing Node-only.

```ts
import { syncScopes } from "@exadev/process-graph-sync";

const result = await syncScopes({
  store,
  sources: (prefix) => (prefix === "github" ? github : undefined),
  modelId: "acme",
  scopes: ["github:acme", "github:partner/sdk"],
  filter: { states: ["open"], labels: ["bug"] },
  signal,
  onProgress: (progress) => {
    record(progress.checkpoint);
  },
});
```

## What a sync writes

Scopes are grouped by their source prefix and read one source after another, in the order each source first appears. Each page is merged into the stored model through `items.upsert` as soon as it is read: participants, bound activities, transitions, relations (`child-of`, `assigned-to`, `part-of`) and run state. A model the store does not have is created by the first write.

A store rejects a write that leaves a transition or relation naming an element or participant the model lacks, and a source may report a dependency or a sub-issue whose other end a later page brings. A transition or relation is therefore held back until the model has both of its ends, and written with the page that completes it. One whose end never arrives is written with the last page, where the store's rejection names the missing reference.

## Progress and resuming

After every page, `onProgress` receives the pages written, the revision of the last write, the distinct participants, activities, transitions and relations written, the gaps met and a `SyncCheckpoint`. A checkpoint names the model, the scopes, the filter, the source to read next and the cursor after the last page written within it; passing it back as `resume` reads only what is left. A source's cursor is valid only with the scopes and filter it was issued for, which is why the checkpoint carries both. `syncCheckpointSchema` is its Zod schema, for a consumer that stores it. The final progress has no checkpoint.

A failure part way leaves every page before it written, and is passed on as the source or store threw it; the last progress's checkpoint says where to carry on. An abort rejects with the signal's reason.

## Filters

`filter` is the source contract's `SyncFilter`: run states, labels and an order. It is passed to every source the sync reads and recorded in every checkpoint. A source that cannot apply a filter to a scope refuses the sync with `BAD_REQUEST`; the GitHub issues adapter does so for a Projects v2 board.

## Functions

| Export                 | What it is                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `syncScopes(request)`  | Syncs the scopes into the store and resolves with the final progress.               |
| `scopesBySource`       | Groups source-qualified scopes by source prefix, in the order a sync reads them.    |
| `syncCheckpointSchema` | The Zod schema of a `SyncCheckpoint`.                                               |
| `UnknownSourceError`   | Thrown for a scope whose source prefix no reader serves; carries the `prefix`.      |
| `InvalidScopeError`    | Thrown for a scope that names no source; carries the `scope`.                       |
| `SyncStore`            | The part of the `GraphStore` client a sync calls: `models.load` and `items.upsert`. |

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests against the source and store contracts' in-memory fakes
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
