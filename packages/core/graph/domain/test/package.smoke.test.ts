import { defineModel } from "@exadev/process-graph-schema";
import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import { deriveStatuses, readySet } from "../dist/index.js";

test("the built package derives status and the ready set", () => {
  const model = defineModel({
    participants: [{ id: "team", label: "Team", kind: "role" }],
    events: [],
    actions: [],
    artefacts: [],
    elements: [
      { kind: "activity", id: "build", label: "Build", actor: "team" },
      { kind: "activity", id: "test", label: "Test", actor: "team" },
    ],
    transitions: [{ id: "t1", source: "build", target: "test" }],
    fragments: [],
    projections: [],
  });
  const facts = () => ({ found: false }) as const;

  expect([...deriveStatuses(model, { build: "done" }, facts)]).toEqual([
    ["build", "done"],
    ["test", "ready"],
  ]);
  expect(readySet(model, {}, facts)).toEqual(["build"]);
});
