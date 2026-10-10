import { toFlowchart } from "@exadev/process-graph-projection";
import { defineModel } from "@exadev/process-graph-schema";
import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import { layout } from "../dist/index.js";

test("the built package lays out a flowchart with the default engine", async () => {
  const model = defineModel({
    participants: [],
    events: [],
    actions: [],
    artefacts: [],
    elements: [
      { kind: "activity", id: "first", label: "First" },
      { kind: "activity", id: "second", label: "Second" },
    ],
    transitions: [{ id: "t1", source: "first", target: "second" }],
    fragments: [],
    projections: [],
  });

  const { views } = await layout(toFlowchart(model));
  const first = views.flowchart?.first;
  const second = views.flowchart?.second;

  expect(first).toBeDefined();
  expect(second?.x).toBeGreaterThan(first?.x ?? Infinity);
});
