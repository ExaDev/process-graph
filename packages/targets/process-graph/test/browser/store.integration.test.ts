import {
  graphStoreConformance,
  everyFieldModel,
} from "@exadev/process-graph-store-contract/conformance";
import { describe, expect, test } from "vitest";
// The built bundle's page entry, as `process-graph/store/wasm` resolves for a consumer.
import { connectGraphStore } from "../../dist/store/wasm.js";

/** Starts a worker serving the named database from the bundle's worker entry, as one tab of an app would. */
const startWorker = (name: string): Worker =>
  new Worker(new URL("store.worker.ts", import.meta.url), {
    type: "module",
    name,
  });

graphStoreConformance({
  name: "the bundled SQLite wasm store in a worker, no cross-origin isolation",
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

describe("the bundled browser store", () => {
  test("keeps a database after the worker that wrote it has gone", async () => {
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
