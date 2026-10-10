import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import { defineModel, validate } from "../dist/index.js";

test("the built package defines and validates a model", () => {
  const model = defineModel({
    participants: [{ id: "shop", label: "Shop", kind: "system" }],
    events: [],
    actions: [],
    artefacts: [],
    elements: [
      { kind: "pseudo", id: "start", role: "initial" },
      { kind: "activity", id: "pack", label: "Pack", actor: "shop" },
    ],
    transitions: [{ id: "t1", source: "start", target: "pack" }],
    fragments: [],
    projections: [],
  });

  expect(validate(model)).toEqual([]);
});
