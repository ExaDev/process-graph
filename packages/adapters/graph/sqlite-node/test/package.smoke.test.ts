import { createGraphStoreRouter } from "@exadev/process-graph-store-contract";
import { createRouterClient } from "@orpc/server";
import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import { openNodeGraphStore } from "../dist/index.js";

test("the built package opens a store that answers through an oRPC client", async () => {
  const { store, close } = openNodeGraphStore(":memory:");
  const client = createRouterClient(createGraphStoreRouter(store));

  await expect(client.v1.models.list()).resolves.toEqual([]);
  close();
});
