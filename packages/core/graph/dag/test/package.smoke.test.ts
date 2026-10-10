import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import {
  buildDag,
  criticalPath,
  findCycles,
  topologicalLayers,
} from "../dist/index.js";

test("the built package analyses a graph end to end", () => {
  const dag = buildDag(["a", "b", "c"], (id) => {
    if (id === "b") return ["a"];
    if (id === "c") return ["b"];

    return [];
  });

  expect(topologicalLayers(dag).layers).toEqual([["a"], ["b"], ["c"]]);
  expect(findCycles(dag)).toEqual([]);
  expect(criticalPath(dag, () => 1)).toEqual({
    path: ["a", "b", "c"],
    weight: 3,
  });
});
