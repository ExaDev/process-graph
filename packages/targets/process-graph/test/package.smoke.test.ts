import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import {
  dag,
  deriveStatuses,
  parseModel,
  readySet,
  toSwimlane,
} from "../dist/index.js";

test("the built package loads a model, projects it and derives its status through one import", () => {
  const model = parseModel({
    participants: [
      { id: "customer", label: "Customer", kind: "role" },
      { id: "shop", label: "Shop", kind: "system" },
    ],
    events: [],
    actions: [],
    artefacts: [],
    elements: [
      { kind: "activity", id: "submit", label: "Submit", actor: "customer" },
      { kind: "activity", id: "pack", label: "Pack", actor: "shop" },
    ],
    transitions: [{ id: "t1", source: "submit", target: "pack" }],
    fragments: [],
    projections: [],
  });
  const facts = () => ({ found: false }) as const;

  expect(
    toSwimlane(model).lanes.map((lane) => [lane.participant, lane.nodes]),
  ).toEqual([
    ["customer", ["submit"]],
    ["shop", ["pack"]],
  ]);
  expect([...deriveStatuses(model, { submit: "done" }, facts)]).toEqual([
    ["submit", "done"],
    ["pack", "ready"],
  ]);
  expect(readySet(model, {}, facts)).toEqual(["submit"]);
  expect(typeof dag.criticalPath).toBe("function");
});
