import {
  createFakeGraphSource,
  createGraphSourceRouter,
} from "@exadev/process-graph-source-contract";
import {
  createFakeGraphStore,
  createGraphStoreRouter,
} from "@exadev/process-graph-store-contract";
import { createRouterClient } from "@orpc/server";
import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import { syncCheckpointSchema, syncScopes } from "../dist/index.js";

test("the built package syncs a source's pages and relations into a store", async () => {
  const store = createRouterClient(
    createGraphStoreRouter(createFakeGraphStore()),
  );
  const source = createRouterClient(
    createGraphSourceRouter(
      createFakeGraphSource({
        source: "fake",
        scopes: {
          "fake:team": [
            {
              participants: [
                { id: "fake:team", label: "team", kind: "system" },
              ],
              activities: [
                {
                  kind: "activity",
                  id: "fake:1",
                  source: "fake:1",
                  label: "Parent",
                  actor: "fake:team",
                },
                {
                  kind: "activity",
                  id: "fake:2",
                  source: "fake:2",
                  label: "Child",
                  actor: "fake:team",
                },
              ],
              transitions: [],
              relations: [{ kind: "child-of", from: "fake:2", to: "fake:1" }],
              overlay: { "fake:1": "open", "fake:2": "open" },
              gaps: [],
            },
          ],
        },
      }),
    ),
  );

  const result = await syncScopes({
    store,
    sources: (prefix) => (prefix === "fake" ? source : undefined),
    modelId: "team",
    scopes: ["fake:team"],
  });

  expect(result.relations).toBe(1);
  expect(
    await store.v1.query.children({ modelId: "team", element: "fake:1" }),
  ).toEqual({ children: ["fake:2"] });
  expect(
    syncCheckpointSchema.parse({
      modelId: "team",
      scopes: ["fake:team"],
      source: "fake",
    }),
  ).toEqual({ modelId: "team", scopes: ["fake:team"], source: "fake" });
});
