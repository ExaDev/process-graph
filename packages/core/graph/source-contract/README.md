# @exadev/process-graph-source-contract

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/@exadev/process-graph-source-contract) [![Release](https://img.shields.io/github/v/release/ExaDev/process-graph)](https://github.com/ExaDev/process-graph/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

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

| Procedure        | Input               | Output                                       |
| ---------------- | ------------------- | -------------------------------------------- |
| `v1.describe`    | none                | `{ source }`: the prefix of every identifier |
| `v1.sync.page`   | `{ scope, after? }` | one `SyncPage`                               |
| `v1.sync.stream` | `{ scope, after? }` | an event iterator of `SyncPage`              |

`scope` lists source-qualified scope identifiers, read in order, each once: for GitHub, `github:org` for every repository an owner has and `github:org/repo` for one. `after` is a cursor from an earlier page's `next`.

A `SyncPage` is a slice of a model: bound activities, the participants they name, the transitions between them, relations, run state as an `Overlay`, and gaps. Its record schemas are taken from `modelSchema`, so a page can never drift from the model.

- **Bound activity.** A model `activity` whose `source` is required and equal to its `id`, a source-qualified identifier such as `github:org/repo#12`. The same record reached twice is the same element.
- **Transition.** One per dependency, from the prerequisite to the work that waits on it.
- **Relation.** A link the model has no field for: `child-of` (a sub-task to its parent), `assigned-to` (an activity to a person) and `part-of` (a repository to its organisation). Relations carry no ordering; a consumer decides whether a parent waits on its children.
- **Gap.** Part of the scope the source could not read (`not-found` or `forbidden`), reported as data so the rest of the sync still arrives.
- **`next`.** The cursor to resume after this page; absent on the last page.

## Resuming

Cursors are stable: the same scope and cursor give the same page while the source is unchanged, and a cursor holds no in-memory state, so a sync interrupted in one process resumes in another. `sync.stream` reads pages only as the consumer pulls them, so a slow consumer applies backpressure and closing the iterator stops the reads. Each event carries its `next` cursor as the event id, so over an event-stream transport a reconnecting client's `lastEventId` resumes there; an explicit `after` takes precedence.

## Errors

Failures that end a call are typed oRPC errors with their detail as data, using oRPC's common codes so an HTTP transport answers with the matching status.

| Code                | Data                                                     | When                                                     |
| ------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `UNAUTHORIZED`      | `{}`                                                     | The source rejected the credentials.                     |
| `TOO_MANY_REQUESTS` | `{ resetAt? }`                                           | The source is rate limiting; resume after `resetAt`.     |
| `BAD_REQUEST`       | `{ reason: "invalid-cursor" \| "invalid-scope", value }` | A cursor the source did not issue, or a malformed scope. |

What a source can partly read is not an error: it is a page with gaps. Every call takes the caller's abort signal through the oRPC client options and passes it to the source.

## Writing an adapter

An adapter implements `GraphSourcePager`, one page at a time, and throws `GraphSourceError` for the failures above. `createGraphSourceRouter(pager)` builds the whole port on it, so paging, streaming, resumption and error mapping are the same for every source.

```ts
const pager: GraphSourcePager = {
  source: "linear",
  page: async ({ scope, cursor, signal }) => readOnePage(scope, cursor, signal),
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
});
```

The entry point also exports `inProcessClient(router)` and `messagePortClient(router)`, the two transports this package's own tests run the kit over; a `messagePortClient` closes its channel after the test file.

It checks that paging and streaming agree; that a stream closed after any page resumes from that page's `next` with exactly the pages that follow; that a cursor never repeats; that a sync is deterministic; that the assembled model and overlay pass the schema's validation and every identifier carries the source prefix; that relations name what the sync returned; that an unknown scope is a gap beside the rest; that malformed scopes and foreign cursors are typed errors; and that an aborted signal ends both procedures.

## Functions

| Export                           | What it is                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `graphSourceContract`            | The router contract.                                                                        |
| `GraphSourceClient`              | The client type for the contract, over any transport.                                       |
| `createGraphSourceRouter(pager)` | The implemented router over a pager.                                                        |
| `assembleSync(pages)`            | Merges a sync's pages into one model, overlay, relation list and gap list; later pages win. |
| `paginate(first, read)`          | An async iterable over a cursor-linked sequence, reading each page only as it is pulled.    |
| `createFakeGraphSource(options)` | The reference in-memory pager.                                                              |
| `GraphSourceError`               | What a pager throws to end a call with a typed failure.                                     |

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests, including the conformance kit over the fake in process and over a message port
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
