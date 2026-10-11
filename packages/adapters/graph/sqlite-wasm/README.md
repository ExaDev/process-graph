# @exadev/process-graph-sqlite-wasm

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

A private workspace package, not published on its own: it is bundled into [`process-graph`](../../../targets/process-graph/README.md), which exposes it as `process-graph/store/wasm`, with its worker entry at `process-graph/store/wasm/worker`.

The SQLite graph store from `@exadev/process-graph-store-sqlite` in the browser. SQLite compiled to WebAssembly (`@sqlite.org/sqlite-wasm`) runs in a dedicated worker on the origin private file system, Drizzle reaches it through `drizzle-orm/sqlite-proxy`, and the page talks to the store over oRPC's message-port transport. Any number of tabs can use one database, and the page needs no `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy` headers.

```ts
// store.worker.ts
import { serveGraphStoreInWorker } from "@exadev/process-graph-sqlite-wasm/worker";

serveGraphStoreInWorker({ name: "graph" });
```

```ts
// in the page
import { connectGraphStore } from "@exadev/process-graph-sqlite-wasm";

const store = connectGraphStore(
  new Worker(new URL("./store.worker.ts", import.meta.url), { type: "module" }),
);
await store.v1.query.ready({ modelId: "release" });
```

With Vite, exclude `@sqlite.org/sqlite-wasm` from dependency pre-bundling (`optimizeDeps.exclude`), since it loads its `.wasm` file relative to itself.

## How tabs share one database

The database lives on SQLite's `opfs-sahpool` VFS. A pool holds its OPFS sync access handles exclusively, so only one worker in the origin can have it open at a time. Every store operation therefore takes an exclusive Web Lock named after the database, unpauses the pool, opens the file, runs, then closes the file and pauses the pool before releasing the lock: tabs take turns rather than failing. The lock covers the whole store operation, not each SQL statement, because a Drizzle transaction is several statements through the proxy. Changes committed in one tab reach every tab's `changes` subscribers over a `BroadcastChannel` named after the database. The schema is migrated on the first operation with the migrations embedded in `graph-store-sqlite`, the same statements the Node driver applies.

## Why this combination

The choice came from a spike recorded in [#22](https://github.com/ExaDev/process-graph/issues/22): two tabs on one database under Playwright, against a Vite dev server with no cross-origin isolation headers, and again with them as a control.

- SQLite's `opfs` and `opfs-wl` VFSes need `SharedArrayBuffer`, which a page has only when cross-origin isolated. Without the headers, `opfs-wl` never installs.
- SQLocal only opens the `opfs` VFS. Without the headers it falls back to an in-memory database with a console warning, so each tab silently writes to its own database and loses it on reload.
- `opfs-sahpool` needs neither, but a second tab cannot open a pool another tab holds (`NoModificationAllowedError`). Pausing the pool between operations under a Web Lock removes that, and is the only combination tried that kept two tabs reading and writing one database without the headers.
- Drizzle's `sqlite-proxy` migrator cannot run in a browser, because `drizzle-orm/migrator` imports `node:fs`; the store applies its migrations itself through the proxy.

Reacquiring the pool's handles on every operation is the cost of this choice. Electing one long-lived owner tab is the alternative if that cost ever matters, and it changes nothing above the worker.

## Tests

The contract's conformance kit runs in Chromium through Vitest's browser mode (`pnpm test:integration`), with a fresh database per test and no cross-origin isolation. Further browser tests run two workers on one database, as two tabs would, and reopen a database after its writer has gone. CI installs Chromium for them with Playwright.
