import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGraphStoreRouter } from "@exadev/process-graph-store-contract";
import {
  everyFieldModel,
  graphStoreConformance,
} from "@exadev/process-graph-store-contract/conformance";
import { createRouterClient } from "@orpc/server";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { createSqliteGraphStore } from "./store.ts";

graphStoreConformance({
  name: "SQLite through drizzle-orm/node-sqlite, in memory",
  createClient: async () => {
    const client = new DatabaseSync(":memory:");

    return Promise.resolve({
      client: createRouterClient(
        createGraphStoreRouter(
          createSqliteGraphStore({ db: drizzle({ client }) }),
        ),
      ),
      close: async () => {
        client.close();

        return Promise.resolve();
      },
    });
  },
});

describe("a store on a database file", () => {
  test("keeps its models and revisions when the file is opened again", async () => {
    const directory = mkdtempSync(join(tmpdir(), "graph-store-sqlite-"));
    const path = join(directory, "graph.sqlite3");
    try {
      const first = new DatabaseSync(path);
      const writer = createRouterClient(
        createGraphStoreRouter(
          createSqliteGraphStore({ db: drizzle({ client: first }) }),
        ),
      );
      const { revision } = await writer.v1.models.save({
        modelId: "orders",
        model: everyFieldModel,
      });
      await writer.v1.overlay.set({
        modelId: "orders",
        overlay: { ship: "done" },
      });
      first.close();

      const second = new DatabaseSync(path);
      const reader = createRouterClient(
        createGraphStoreRouter(
          createSqliteGraphStore({ db: drizzle({ client: second }) }),
        ),
      );
      const stored = await reader.v1.models.load({ modelId: "orders" });
      const next = await reader.v1.models.save({
        modelId: "other",
        model: everyFieldModel,
      });
      second.close();

      expect(stored).toStrictEqual({
        modelId: "orders",
        revision: revision + 1,
        model: everyFieldModel,
        overlay: { ship: "done" },
      });
      expect(next.revision).toBeGreaterThan(stored.revision);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
