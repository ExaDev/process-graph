import type { LayoutEngine } from "@exadev/process-graph-layout";
import { noFacts } from "@exadev/process-graph-react";
import { defineModel } from "@exadev/process-graph-schema";
import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map, a build that left Vanilla Extract calls in the JavaScript, or a stylesheet the build failed to emit.
import { ProcessFlow } from "../dist/index.js";

afterEach(cleanup);

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

/** Every node in a row, without elkjs. */
const engine: LayoutEngine = {
  arrange: async (graph) =>
    Promise.resolve(
      graph.nodes.map((node, index) => ({
        id: node.id,
        x: index * (node.width + graph.layerGap),
        y: 0,
        width: node.width,
        height: node.height,
      })),
    ),
};
const layout = { engine };

test("the built package draws a flowchart's elements and edge", async () => {
  const { container } = render(
    <ProcessFlow
      run={{ model, overlay: { first: "done" }, facts: noFacts }}
      projection={{ id: "flow", notation: "flowchart" }}
      label="Two steps"
      layout={layout}
    />,
  );

  await waitFor(() => {
    expect(container.querySelector('[data-transitions="t1"]')).not.toBeNull();
  });
  expect(
    container
      .querySelector('[data-element-id="second"]')
      ?.getAttribute("data-status"),
  ).toBe("ready");
});

test("the built stylesheet carries React Flow's rules", () => {
  const stylesheet = readFileSync(
    join(import.meta.dirname, "../dist/style.css"),
    "utf8",
  );

  expect(stylesheet).toContain(".react-flow__node");
});
