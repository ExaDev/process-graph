import { project } from "@exadev/process-graph-projection";
import { defineModel } from "@exadev/process-graph-schema";
import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import { terminalText, viewText } from "../dist/index.js";

test("the built package writes a projected view as Mermaid, DOT and JSON", () => {
  const model = defineModel({
    participants: [{ id: "shop", label: "Shop", kind: "system" }],
    events: [],
    actions: [],
    artefacts: [],
    elements: [
      { kind: "activity", id: "pack", label: "Pack", actor: "shop" },
      { kind: "activity", id: "ship", label: "Ship", actor: "shop" },
    ],
    transitions: [{ id: "t1", source: "pack", target: "ship" }],
    fragments: [],
    projections: [],
  });
  const projected = project(model, { id: "flow", notation: "flowchart" });

  expect(viewText(model, projected, "mermaid")).toContain('n0["Pack"]');
  expect(viewText(model, projected, "dot")).toContain('"pack" -> "ship"');
  expect(JSON.parse(viewText(model, projected, "json"))).toEqual(
    projected.view,
  );
  expect(terminalText("a\u001bb")).toBe("a\\u{1b}b");
});
