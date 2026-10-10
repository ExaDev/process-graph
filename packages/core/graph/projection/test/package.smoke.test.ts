import { defineModel } from "@exadev/process-graph-schema";
import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import { handoffs, toFlowchart } from "../dist/index.js";

test("the built package projects a model", () => {
  const model = defineModel({
    participants: [
      { id: "customer", label: "Customer", kind: "role" },
      { id: "shop", label: "Shop", kind: "system" },
    ],
    events: [],
    actions: [],
    elements: [
      { kind: "activity", id: "submit", label: "Submit", actor: "customer" },
      { kind: "activity", id: "pack", label: "Pack", actor: "shop" },
    ],
    transitions: [{ id: "t1", source: "submit", target: "pack" }],
    fragments: [],
    projections: [],
  });

  expect(handoffs(model)).toEqual([
    { transition: "t1", from: "customer", to: "shop" },
  ]);
  expect(toFlowchart(model).edges).toEqual([{ from: "submit", to: "pack" }]);
});
