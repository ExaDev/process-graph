# @exadev/process-graph-sqlite-node

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

A private workspace package, not published on its own: it is bundled into [`process-graph`](../../../targets/process-graph/README.md), which exposes it as `process-graph/store/node`.

The SQLite graph store from `@exadev/process-graph-store-sqlite` on Node's built-in `node:sqlite`, through `drizzle-orm/node-sqlite`. It is the driver for the command line and for servers, and needs no native module.

```ts
import { createGraphStoreRouter } from "@exadev/process-graph-store-contract";
import { openNodeGraphStore } from "@exadev/process-graph-sqlite-node";
import { createRouterClient } from "@orpc/server";

const { store, close } = openNodeGraphStore("graph.sqlite3");
const client = createRouterClient(createGraphStoreRouter(store));

await client.v1.query.ready({ modelId: "release" });
close();
```

`openNodeGraphStore(path, options)` opens the file (or `":memory:"`), passing `node:sqlite`'s own options through, and the store migrates the schema on its first operation with the migrations embedded in `graph-store-sqlite`, the same ones the browser driver applies. A file database is switched to write-ahead logging, so a reader in another process is not blocked by a writer; set `timeout` to have a write wait for another process's lock. The store's change feed sees only the writes made through it, so a subscriber in one process does not hear another process's changes.

`prepareDataFile(path, { ownsDirectory, platform })` makes a data file private before the store opens it, since a store holds synced work that other users on the host must not read. It creates the directory when missing, readable by its owner only (`privateDirectoryMode`, `0700`) when the caller owns it, and creates the database file owner-only (`privateFileMode`, `0600`) before SQLite opens it, so the `-wal` and `-shm` files SQLite derives from it are private too, whatever the umask. In a directory the caller owns, an existing directory or store file others can read is narrowed to those modes and the call returns one warning naming what changed, for the caller to show; in a directory someone else chose, the directory and an existing file are left as they are. On Windows, where file modes mean nothing, it only creates the directory.

```ts
import {
  openNodeGraphStore,
  prepareDataFile,
} from "@exadev/process-graph-sqlite-node";

const path = join(appHome, "graph", "graph.sqlite3");
for (const warning of prepareDataFile(path, {
  ownsDirectory: true,
  platform: process.platform,
})) {
  console.warn(warning);
}
const { store, close } = openNodeGraphStore(path);
```

The contract's conformance kit runs against an in-memory database in process and against a file database over a `MessageChannel`.
