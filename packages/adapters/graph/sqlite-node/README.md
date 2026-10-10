# @exadev/process-graph-sqlite-node

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/@exadev/process-graph-sqlite-node) [![Release](https://img.shields.io/github/v/release/ExaDev/process-graph)](https://github.com/ExaDev/process-graph/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

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

The contract's conformance kit runs against an in-memory database in process and against a file database over a `MessageChannel`.
