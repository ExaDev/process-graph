import { describe, expect, it } from "vitest";
import { CycleError } from "./errors.ts";
import { transitiveReduction } from "./reduction.ts";
import { dagOf } from "./test-support/dag-of.ts";

describe("transitiveReduction", () => {
  it("drops the shortcut edge across a chain", () => {
    const reduced = transitiveReduction(
      dagOf({ a: [], b: ["a"], c: ["b", "a"] }),
    );

    expect(reduced.needs.get("c")).toEqual(["b"]);
    expect(reduced.needs.get("b")).toEqual(["a"]);
    expect(reduced.dependents.get("a")).toEqual(["b"]);
  });

  it("removes the edge that a diamond already implies and keeps the diamond", () => {
    const reduced = transitiveReduction(
      dagOf({ a: [], b: ["a"], c: ["a"], d: ["b", "c", "a"] }),
    );

    expect(reduced.needs.get("d")).toEqual(["b", "c"]);
    expect(reduced.needs.get("b")).toEqual(["a"]);
    expect(reduced.needs.get("c")).toEqual(["a"]);
  });

  it("leaves a graph with no redundant edges unchanged", () => {
    const reduced = transitiveReduction(
      dagOf({ a: [], b: ["a"], c: ["a"], d: ["b", "c"], e: [] }),
    );

    expect([...reduced.needs]).toEqual([
      ["a", []],
      ["b", ["a"]],
      ["c", ["a"]],
      ["d", ["b", "c"]],
      ["e", []],
    ]);
  });

  it("removes a redundancy that spans several hops", () => {
    const reduced = transitiveReduction(
      dagOf({ a: [], b: ["a"], c: ["b"], d: ["c", "a"] }),
    );

    expect(reduced.needs.get("d")).toEqual(["c"]);
  });

  it("carries unknown references over unchanged", () => {
    const reduced = transitiveReduction(dagOf({ a: ["ghost"], b: ["a"] }));

    expect(reduced.unknownReferences).toEqual([
      { from: "a", missing: "ghost" },
    ]);
  });

  it("throws a CycleError naming the cycle when the graph is cyclic", () => {
    const attempt = (): unknown =>
      transitiveReduction(dagOf({ a: ["b"], b: ["a"] }));

    expect(attempt).toThrow(CycleError);
    expect(attempt).toThrow("a -> b -> a");
  });
});
