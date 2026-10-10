import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import {
  createGraphStoreRouter,
  type GraphStoreClient,
} from "@exadev/process-graph-store-contract";
import {
  everyFieldModel,
  graphStoreConformance,
} from "@exadev/process-graph-store-contract/conformance";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { createRouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { openNodeGraphStore } from "./open.ts";

graphStoreConformance({
  name: "node:sqlite in memory, in process",
  createClient: async () => {
    const { store, close } = openNodeGraphStore(":memory:");

    return Promise.resolve({
      client: createRouterClient(createGraphStoreRouter(store)),
      close: async () => {
        close();

        return Promise.resolve();
      },
    });
  },
});

graphStoreConformance({
  name: "node:sqlite on a file, over a message port",
  createClient: async () => {
    const directory = mkdtempSync(join(tmpdir(), "graph-sqlite-node-"));
    const { store, close } = openNodeGraphStore(
      join(directory, "graph.sqlite3"),
    );
    const { port1, port2 } = new MessageChannel();
    new RPCHandler(createGraphStoreRouter(store)).upgrade(port1);
    port1.start();
    const client: GraphStoreClient = createORPCClient(
      new RPCLink({ port: port2 }),
    );
    port2.start();

    return Promise.resolve({
      client,
      close: async () => {
        port1.close();
        port2.close();
        close();
        rmSync(directory, { recursive: true });

        return Promise.resolve();
      },
    });
  },
});

describe("openNodeGraphStore", () => {
  test("puts a file database in write-ahead logging and keeps what was saved across a reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "graph-sqlite-node-"));
    const path = join(directory, "graph.sqlite3");
    try {
      const first = openNodeGraphStore(path);
      await createRouterClient(
        createGraphStoreRouter(first.store),
      ).v1.models.save({
        modelId: "orders",
        model: everyFieldModel,
      });
      expect(first.db.values(sql`PRAGMA journal_mode`)).toEqual([["wal"]]);
      first.close();

      const second = openNodeGraphStore(path);
      const loaded = await createRouterClient(
        createGraphStoreRouter(second.store),
      ).v1.models.load({ modelId: "orders" });
      second.close();

      expect(loaded.model).toStrictEqual(everyFieldModel);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
