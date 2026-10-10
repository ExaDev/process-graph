import { createRouterClient } from "@orpc/server";
import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import {
  createFakeGraphStore,
  createGraphStoreRouter,
  emptyModel,
} from "../dist/index.js";

test("the built package serves a store through an oRPC client", async () => {
  const client = createRouterClient(
    createGraphStoreRouter(createFakeGraphStore()),
  );
  const { revision } = await client.v1.models.save({
    modelId: "empty",
    model: emptyModel,
  });

  await expect(client.v1.models.list()).resolves.toEqual([
    { modelId: "empty", revision },
  ]);
});

test("the conformance kit is its own entry point", async () => {
  const kit = await import("../dist/conformance.js");

  expect(typeof kit.graphStoreConformance).toBe("function");
});
