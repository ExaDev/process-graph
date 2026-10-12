# @exadev/process-graph-source-contract

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

A private workspace package, not published on its own: it is bundled into [`process-graph`](../../../targets/process-graph/README.md), which exposes it as `process-graph/source/github`, beside the GitHub issues adapter.

The `GraphSource` port: how the process model from `@exadev/process-graph-schema` reads work from an external tracker. It is an [oRPC](https://orpc.dev) router contract (`@orpc/contract`), so one definition is called in process, across a `MessagePort` to a worker, or over HTTP, and a consumer never changes with the transport. The package also ships the router builder adapters use, an in-memory fake and the conformance kit every adapter must pass. `src/` imports nothing Node-only.

```ts
import { createRouterClient } from "@orpc/server";
import {
  assembleSync,
  createFakeGraphSource,
  createGraphSourceRouter,
} from "@exadev/process-graph-source-contract";

const router = createGraphSourceRouter(
  createFakeGraphSource({ source: "fake", scopes }),
);
const client = createRouterClient(router);

const pages = [];
for await (const page of await client.v1.sync.stream({
  scope: ["fake:acme/alpha"],
})) {
  pages.push(page);
}
const { model, overlay, relations, gaps } = assembleSync(pages);
```

## The contract

`graphSourceContract` is keyed by version. A breaking change adds `v2` beside `v1`, so one server serves both while clients move across.

| Procedure            | Input                        | Output                                          |
| -------------------- | ---------------------------- | ----------------------------------------------- |
| `v1.describe`        | none                         | `{ source }`: the prefix of every identifier    |
| `v1.sync.page`       | `{ scope, after?, filter? }` | one `SyncPage`                                  |
| `v1.sync.stream`     | `{ scope, after?, filter? }` | an event iterator of `SyncPage`                 |
| `v1.scopes.roots`    | `{ after? }`                 | one `ScopeListing` of the top-level scopes      |
| `v1.scopes.children` | `{ scope, after? }`          | one `ScopeListing` of the scopes inside `scope` |

`scope` lists source-qualified scope identifiers, read in order, each once: for GitHub, `github:org` for every repository an owner has and `github:org/repo` for one. `after` is a cursor from an earlier page's `next`, valid only with the scope list and filter it was issued for.

A `SyncPage` is a slice of a model: bound activities, the participants they name, the transitions between them, relations, run state as an `Overlay`, and gaps. Its record schemas are taken from `modelSchema`, so a page can never drift from the model.

- **Bound activity.** A model `activity` whose `source` is required and equal to its `id`, a source-qualified identifier such as `github:org/repo#12`. The same record reached twice is the same element. Its schema is graph-schema's `boundActivitySchema`, the same one the store contract's `items.upsert` accepts.
- **Transition.** One per dependency, from the prerequisite to the work that waits on it.
- **Relation.** A link the model has no field for: `child-of` (a sub-task to its parent), `assigned-to` (an activity to a person) and `part-of` (a repository to its organisation). Relations carry no ordering; a consumer decides whether a parent waits on its children.
- **Gap.** Part of the scope the source could not read (`not-found` or `forbidden`), reported as data so the rest of the sync still arrives.
- **`next`.** The cursor to resume after this page; absent on the last page.

## Filters

`filter` narrows and orders what each scope lists, on the source's side where the source supports it. Every field is optional, and an absent field does not narrow.

| Field    | Keeps or orders                                                                          |
| -------- | ---------------------------------------------------------------------------------------- |
| `states` | Records whose run state is one of `open` and `done`.                                     |
| `labels` | Records carrying at least one of the labels.                                             |
| `order`  | `{ field, direction }`: `created`, `updated` or `comments`, `ascending` or `descending`. |

A filter narrows what a scope lists, not what the listed records reach: a blocker of a listed record is read whatever its own state or labels, because the work the filter kept depends on it.

## Listing scopes

`scopes.roots` lists the top-level scopes the credentials reach (for GitHub, the viewer's own account and organisations) and `scopes.children` the scopes inside one (for GitHub, an owner's repositories), so a scope picker can offer them. A `ScopeListing` holds `entries`, `gaps` and `next`; each `ScopeEntry` has the `scope` identifier to pass to `sync`, a `label`, the source's `description` and `url` when it has them, and whether it is `archived`. Listings page and resume by cursor like `sync.page`, take the abort signal, and report a parent that does not exist or cannot be seen as a gap on an empty page. A source that offers no listing answers `NOT_IMPLEMENTED`.

## Resuming

Cursors are stable: the same scope and cursor give the same page while the source is unchanged, and a cursor holds no in-memory state, so a sync interrupted in one process resumes in another. `sync.stream` reads pages only as the consumer pulls them, so a slow consumer applies backpressure and closing the iterator stops the reads. Each event carries its `next` cursor as the event id, so over an event-stream transport a reconnecting client's `lastEventId` resumes there; an explicit `after` takes precedence.

## Errors

Failures that end a call are typed oRPC errors with their detail as data, using oRPC's common codes so an HTTP transport answers with the matching status.

| Code                | Data                                                     | When                                                     |
| ------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `UNAUTHORIZED`      | `{}`                                                     | The source rejected the credentials.                     |
| `TOO_MANY_REQUESTS` | `{ resetAt? }`                                           | The source is rate limiting; resume after `resetAt`.     |
| `BAD_REQUEST`       | `{ reason: "invalid-cursor" \| "invalid-scope", value }` | A cursor the source did not issue, or a malformed scope. |
| `NOT_IMPLEMENTED`   | `{}`                                                     | A scope listing from a source that offers none.          |

What a source can partly read is not an error: it is a page with gaps. Every call takes the caller's abort signal through the oRPC client options and passes it to the source.

## Writing an adapter

An adapter implements `GraphSourcePager`, one page at a time, and throws `GraphSourceError` for the failures above. `createGraphSourceRouter(pager)` builds the whole port on it, so paging, streaming, resumption and error mapping are the same for every source. A pager that can list its scopes also supplies `scopes`, a `GraphSourceScopes` with `roots` and `children`.

```ts
const pager: GraphSourcePager = {
  source: "linear",
  page: async ({ scope, cursor, signal, filter }) =>
    readOnePage(scope, cursor, signal, filter),
  scopes: {
    roots: async ({ cursor, signal }) => listTeams(cursor, signal),
    children: async ({ scope, cursor, signal }) =>
      listProjects(scope, cursor, signal),
  },
};
```

## Conformance

`@exadev/process-graph-source-contract/conformance` exports `graphSourceConformance`, a set of Vitest tests (Vitest is an optional peer dependency, needed only for this entry point). Call it from the adapter's own tests, once per transport; the tests talk only to the oRPC client.

```ts
import {
  graphSourceConformance,
  inProcessClient,
} from "@exadev/process-graph-source-contract/conformance";

graphSourceConformance({
  name: "my adapter, in process",
  createClient: () => inProcessClient(createGraphSourceRouter(pager)),
  scope: ["linear:team-a"], // must span at least two pages
  missingScope: "linear:no-such-team",
  malformedScope: "team-a",
  // Optional: exercise the scope listing too.
  listing: {
    roots: true,
    parent: "linear:team-a", // its children must span at least two pages
    missingParent: "linear:no-such-team",
    malformedParent: "team-a",
  },
});
```

`graphSourceListingConformance` runs the listing's share on its own, for a client that differs from the sync's, such as one with a smaller page size so the parent spans two pages. The entry point also exports `conformanceFilter`, the filter the kit syncs with, so an adapter that replays recorded responses can record them, and `inProcessClient(router)` and `messagePortClient(router)`, the two transports this package's own tests run the kit over; a `messagePortClient` closes its channel after the test file.

It checks that paging and streaming agree; that a stream closed after any page resumes from that page's `next` with exactly the pages that follow; that a cursor never repeats; that a sync is deterministic; that the assembled model and overlay pass the schema's validation and every identifier carries the source prefix; that relations name what the sync returned; that an unknown scope is a gap beside the rest; that malformed scopes and foreign cursors are typed errors; that a filtered sync pages consistently, reads nothing the unfiltered sync does not and refuses a cursor issued under another filter; and that an aborted signal ends both procedures. With `listing`, it also checks the scope listing's paging and resumption, the gap for an unknown parent, its typed errors and aborts, and that a listed child syncs.

## Functions

| Export                           | What it is                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graphSourceContract`            | The router contract.                                                                                                                                                                        |
| `GraphSourceClient`              | The client type for the contract, over any transport.                                                                                                                                       |
| `createGraphSourceRouter(pager)` | The implemented router over a pager.                                                                                                                                                        |
| `assembleSync(pages)`            | Merges a sync's pages into one model, overlay, relation list and gap list; later pages win.                                                                                                 |
| `paginate(first, read)`          | An async iterable over a cursor-linked sequence, reading each page only as it is pulled.                                                                                                    |
| `createFakeGraphSource(options)` | The reference in-memory pager: fixed pages per scope, a filter applied to each page as though only the kept activities were listed, and a scope listing served from `roots` and `children`. |
| `GraphSourceError`               | What a pager throws to end a call with a typed failure.                                                                                                                                     |

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests, including the conformance kit over the fake in process and over a message port
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
