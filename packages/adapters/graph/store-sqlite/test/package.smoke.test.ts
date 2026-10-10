import { createGraphStoreRouter } from "@exadev/process-graph-store-contract";
import { everyFieldModel } from "@exadev/process-graph-store-contract/conformance";
import { createRouterClient } from "@orpc/server";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map, or migrations missing from the build, that a unit test importing straight from src/ never touches.
import { createSqliteGraphStore } from "../dist/index.js";

test("the built package migrates a new database and round-trips a model", async () => {
  const client = createRouterClient(
    createGraphStoreRouter(
      createSqliteGraphStore({
        db: drizzle({ client: new DatabaseSync(":memory:") }),
      }),
    ),
  );
  await client.v1.models.save({ modelId: "orders", model: everyFieldModel });

  await expect(
    client.v1.models.load({ modelId: "orders" }),
  ).resolves.toMatchObject({ model: everyFieldModel, overlay: {} });
});
