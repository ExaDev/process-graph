import { describe, expect, it } from "vitest";
import { topologicalLayers } from "./layers.ts";
import { dagOf } from "./test-support/dag-of.ts";

/** Far deeper than any call stack tolerates in a recursive walk, so an accidental recursion fails here. */
const deepChainLength = 100_000;

describe("topologicalLayers", () => {
  it("layers a diamond by longest chain", () => {
    const result = topologicalLayers(
      dagOf({ d: ["b", "c"], b: ["a"], c: ["a"], a: [] }),
    );

    expect(result.layers).toEqual([["a"], ["b", "c"], ["d"]]);
    expect(Object.fromEntries(result.levels)).toEqual({
      a: 0,
      b: 1,
      c: 1,
      d: 2,
    });
    expect(result.unlayered).toEqual([]);
  });

  it("layers a node that needs a diamond", () => {
    const result = topologicalLayers(
      dagOf({ a: [], b: ["a"], c: ["a"], d: ["b", "c"], e: ["d"] }),
    );

    expect(result.layers).toEqual([["a"], ["b", "c"], ["d"], ["e"]]);
    expect(result.unlayered).toEqual([]);
  });

  it("places a node above its deepest need, not its shallowest", () => {
    const result = topologicalLayers(dagOf({ a: [], b: ["a"], c: ["b", "a"] }));

    expect(result.levels.get("c")).toBe(2);
    expect(result.layers).toEqual([["a"], ["b"], ["c"]]);
  });

  it("puts an isolated node in layer 0", () => {
    const result = topologicalLayers(dagOf({ a: [], lone: [] }));

    expect(result.layers).toEqual([["a", "lone"]]);
  });

  it("ignores unknown references when computing a level", () => {
    const result = topologicalLayers(dagOf({ a: ["ghost"], b: ["a"] }));

    expect(result.levels.get("a")).toBe(0);
    expect(result.levels.get("b")).toBe(1);
  });

  it("reports nodes on or above a cycle as unlayered and layers the rest", () => {
    const result = topologicalLayers(
      dagOf({ w: [], x: ["y"], y: ["x"], z: ["x"], v: ["w"] }),
    );

    expect(result.layers).toEqual([["w"], ["v"]]);
    expect(result.unlayered).toEqual(["x", "y", "z"]);
    expect(result.levels.has("x")).toBe(false);
  });

  it("reports a self-loop as unlayered", () => {
    const result = topologicalLayers(dagOf({ a: ["a"] }));

    expect(result.layers).toEqual([]);
    expect(result.unlayered).toEqual(["a"]);
  });

  it("handles a chain deeper than the call stack", () => {
    const table: Record<string, string[]> = {};
    for (let index = 0; index < deepChainLength; index += 1) {
      table[`n${String(index)}`] = index === 0 ? [] : [`n${String(index - 1)}`];
    }

    const result = topologicalLayers(dagOf(table));

    expect(result.layers).toHaveLength(deepChainLength);
    expect(result.levels.get(`n${String(deepChainLength - 1)}`)).toBe(
      deepChainLength - 1,
    );
  });
});
