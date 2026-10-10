import { createRouterClient } from "@orpc/server";
import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import {
  assembleSync,
  createFakeGraphSource,
  createGraphSourceRouter,
} from "../dist/index.js";
import { graphSourceConformance } from "../dist/conformance.js";

const fake = createFakeGraphSource({
  source: "fake",
  scopes: {
    "fake:o/r": [
      {
        participants: [{ id: "fake:o/r", label: "o/r", kind: "system" }],
        activities: [
          {
            kind: "activity",
            id: "fake:o/r#1",
            source: "fake:o/r#1",
            label: "One",
            actor: "fake:o/r",
          },
        ],
        transitions: [],
        relations: [],
        overlay: { "fake:o/r#1": "open" },
        gaps: [],
      },
      {
        participants: [{ id: "fake:o/r", label: "o/r", kind: "system" }],
        activities: [
          {
            kind: "activity",
            id: "fake:o/r#2",
            source: "fake:o/r#2",
            label: "Two",
            actor: "fake:o/r",
          },
        ],
        transitions: [
          {
            id: "fake:o/r#1->fake:o/r#2",
            source: "fake:o/r#1",
            target: "fake:o/r#2",
          },
        ],
        relations: [],
        overlay: { "fake:o/r#2": "open" },
        gaps: [],
      },
    ],
  },
});
const router = createGraphSourceRouter(fake);

test("the built package syncs and assembles a model", async () => {
  const client = createRouterClient(router);
  const first = await client.v1.sync.page({ scope: ["fake:o/r"] });
  const second = await client.v1.sync.page({
    scope: ["fake:o/r"],
    after: first.next ?? "",
  });
  expect(assembleSync([first, second]).model.transitions).toHaveLength(1);
});

graphSourceConformance({
  name: "the built fake",
  createClient: () => createRouterClient(router),
  scope: ["fake:o/r"],
  missingScope: "fake:o/missing",
  malformedScope: "o/r",
});
