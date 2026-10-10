import { describe, expect, it } from "vitest";
import { ancestorsOf, descendantsOf } from "./reachability.ts";
import { UnknownNodeError } from "./errors.ts";
import { dagOf } from "./test-support/dag-of.ts";

const diamond = dagOf({ a: [], b: ["a"], c: ["a"], d: ["b", "c"], e: [] });

describe("ancestorsOf", () => {
  it("returns everything a node depends on, transitively, in node order", () => {
    expect(ancestorsOf(diamond, "d")).toEqual(["a", "b", "c"]);
    expect(ancestorsOf(diamond, "b")).toEqual(["a"]);
  });

  it("returns nothing for a node with no needs and for an isolated node", () => {
    expect(ancestorsOf(diamond, "a")).toEqual([]);
    expect(ancestorsOf(diamond, "e")).toEqual([]);
  });

  it("includes the node itself exactly when it is on a cycle", () => {
    const cyclic = dagOf({ a: ["b"], b: ["a"], c: ["a"] });

    expect(ancestorsOf(cyclic, "a")).toEqual(["a", "b"]);
    expect(ancestorsOf(cyclic, "c")).toEqual(["a", "b"]);
  });

  it("throws for an id that is not a node", () => {
    expect(() => ancestorsOf(diamond, "ghost")).toThrow(UnknownNodeError);
  });
});

describe("descendantsOf", () => {
  it("returns everything that depends on a node, transitively, in node order", () => {
    expect(descendantsOf(diamond, "a")).toEqual(["b", "c", "d"]);
    expect(descendantsOf(diamond, "c")).toEqual(["d"]);
  });

  it("returns nothing for a leaf dependent and for an isolated node", () => {
    expect(descendantsOf(diamond, "d")).toEqual([]);
    expect(descendantsOf(diamond, "e")).toEqual([]);
  });

  it("includes a self-looping node itself", () => {
    expect(descendantsOf(dagOf({ a: ["a"] }), "a")).toEqual(["a"]);
  });

  it("throws for an id that is not a node", () => {
    expect(() => descendantsOf(diamond, "ghost")).toThrow(UnknownNodeError);
  });
});
