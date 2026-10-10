import { describe, expect, it } from "vitest";
import { buildDag } from "./dag.ts";
import { dagOf } from "./test-support/dag-of.ts";

describe("buildDag", () => {
  it("keeps node order and exposes needs and their inverse", () => {
    const dag = dagOf({ a: [], b: ["a"], c: ["a"], d: ["b", "c"] });

    expect(dag.nodes).toEqual(["a", "b", "c", "d"]);
    expect(dag.needs.get("d")).toEqual(["b", "c"]);
    expect(dag.dependents.get("a")).toEqual(["b", "c"]);
    expect(dag.dependents.get("d")).toEqual([]);
    expect(dag.unknownReferences).toEqual([]);
  });

  it("drops duplicate nodes and duplicate needs, keeping first occurrences", () => {
    const dag = buildDag(["a", "b", "a"], (id) =>
      id === "b" ? ["a", "a"] : [],
    );

    expect(dag.nodes).toEqual(["a", "b"]);
    expect(dag.needs.get("b")).toEqual(["a"]);
    expect(dag.dependents.get("a")).toEqual(["b"]);
  });

  it("reports needs that are not nodes as data and leaves them out of the edges", () => {
    const dag = dagOf({ a: ["ghost"], b: ["a", "phantom", "ghost", "ghost"] });

    expect(dag.unknownReferences).toEqual([
      { from: "a", missing: "ghost" },
      { from: "b", missing: "phantom" },
      { from: "b", missing: "ghost" },
    ]);
    expect(dag.needs.get("a")).toEqual([]);
    expect(dag.needs.get("b")).toEqual(["a"]);
  });

  it("keeps a node that needs itself as an edge", () => {
    const dag = dagOf({ a: ["a"] });

    expect(dag.needs.get("a")).toEqual(["a"]);
    expect(dag.dependents.get("a")).toEqual(["a"]);
  });

  it("calls the needs accessor exactly once per distinct node, in node order", () => {
    const calls: string[] = [];
    buildDag(["x", "y", "x"], (id) => {
      calls.push(id);

      return [];
    });

    expect(calls).toEqual(["x", "y"]);
  });

  it("accepts numeric ids", () => {
    const first = 1;
    const second = 2;
    const third = 3;
    const dag = buildDag([first, second, third], (id) =>
      id === third ? [first, second] : [],
    );

    expect(dag.needs.get(third)).toEqual([first, second]);
  });
});
