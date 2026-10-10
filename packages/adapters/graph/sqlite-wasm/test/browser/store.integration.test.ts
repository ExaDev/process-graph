import type { StoreChange } from "@exadev/process-graph-store-contract";
import {
  everyFieldModel,
  graphStoreConformance,
} from "@exadev/process-graph-store-contract/conformance";
import { describe, expect, test } from "vitest";
import { connectGraphStore } from "../../src/client.ts";

/** Starts a worker serving the named database, as one tab of the app would. */
const startWorker = (name: string): Worker =>
  new Worker(new URL("store.worker.ts", import.meta.url), {
    type: "module",
    name,
  });

graphStoreConformance({
  name: "SQLite wasm in a worker on opfs-sahpool, no cross-origin isolation",
  createClient: async () => {
    const worker = startWorker(`conformance-${crypto.randomUUID()}`);

    return Promise.resolve({
      client: connectGraphStore(worker),
      close: async () => {
        worker.terminate();

        return Promise.resolve();
      },
    });
  },
});

describe("two workers on one database, as two tabs", () => {
  test("runs without cross-origin isolation", () => {
    expect(crossOriginIsolated).toBe(false);
  });

  test("both read and write it, each sees the other's writes, and a subscriber in one hears the other", async () => {
    const name = `tabs-${crypto.randomUUID()}`;
    const first = startWorker(name);
    const second = startWorker(name);
    const one = connectGraphStore(first);
    const two = connectGraphStore(second);
    try {
      const saved = await one.v1.models.save({
        modelId: "orders",
        model: everyFieldModel,
      });
      const events = await one.v1.changes({ modelId: "orders" });
      const heard = (async (): Promise<StoreChange | undefined> => {
        for await (const change of events) {
          return change;
        }

        return undefined;
      })();

      await expect(
        two.v1.models.load({ modelId: "orders" }),
      ).resolves.toMatchObject({
        revision: saved.revision,
        model: everyFieldModel,
      });
      const set = await two.v1.overlay.set({
        modelId: "orders",
        overlay: { ship: "done" },
      });

      await expect(heard).resolves.toEqual({
        modelId: "orders",
        kind: "overlay",
        revision: set.revision,
      });
      await expect(
        one.v1.models.load({ modelId: "orders" }),
      ).resolves.toMatchObject({ overlay: { ship: "done" } });
    } finally {
      first.terminate();
      second.terminate();
    }
  });

  test("a database outlives the workers that wrote it", async () => {
    const name = `reopen-${crypto.randomUUID()}`;
    const writer = startWorker(name);
    await connectGraphStore(writer).v1.models.save({
      modelId: "orders",
      model: everyFieldModel,
    });
    writer.terminate();

    const reader = startWorker(name);
    try {
      await expect(
        connectGraphStore(reader).v1.models.load({ modelId: "orders" }),
      ).resolves.toMatchObject({ model: everyFieldModel });
    } finally {
      reader.terminate();
    }
  });
});
