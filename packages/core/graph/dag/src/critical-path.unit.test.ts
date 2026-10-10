import { describe, expect, it } from "vitest";
import { criticalPath } from "./critical-path.ts";
import { CycleError } from "./errors.ts";
import { dagOf } from "./test-support/dag-of.ts";

/** Builds a weight function from a table, so each test states its costs next to its graph. */
function weightsFrom(
  table: Readonly<Record<string, number>>,
): (id: string) => number {
  const weights = new Map(Object.entries(table));

  return (id) => {
    const weight = weights.get(id);
    if (weight === undefined) {
      throw new Error(`No weight given for ${id}`);
    }

    return weight;
  };
}

describe("criticalPath", () => {
  it("finds the unique heaviest chain and its total", () => {
    const dag = dagOf({ a: [], b: ["a"], c: ["a"], d: ["b", "c"] });

    const result = criticalPath(dag, weightsFrom({ a: 1, b: 5, c: 2, d: 1 }));

    expect(result).toEqual({ path: ["a", "b", "d"], weight: 7 });
  });

  it("prefers a longer chain of small weights over a short heavy one when it totals more", () => {
    const dag = dagOf({ a: [], x: ["a"], y: ["x"], z: ["y"], h: ["a"] });

    const result = criticalPath(
      dag,
      weightsFrom({ a: 1, x: 2, y: 2, z: 2, h: 5 }),
    );

    expect(result).toEqual({ path: ["a", "x", "y", "z"], weight: 7 });
  });

  it("follows the heavier need even when it comes later in node order", () => {
    const dag = dagOf({ a: [], b: ["a"], c: ["a"], d: ["b", "c"] });

    const result = criticalPath(dag, weightsFrom({ a: 1, b: 1, c: 5, d: 1 }));

    expect(result).toEqual({ path: ["a", "c", "d"], weight: 7 });
  });

  it("follows the heavier need even when it is listed before a lighter, earlier node", () => {
    const dag = dagOf({ a: [], b: ["a"], c: ["a"], d: ["c", "b"] });

    const result = criticalPath(dag, weightsFrom({ a: 1, b: 1, c: 5, d: 1 }));

    expect(result).toEqual({ path: ["a", "c", "d"], weight: 7 });
  });

  it("names the offending node and weight when rejecting one", () => {
    const negative = -2;

    expect(() => criticalPath(dagOf({ a: [] }), () => negative)).toThrow(
      'The weight of "a" must be a finite, non-negative number, got -2',
    );
  });

  it("breaks a tie between needs in favour of the one first in node order", () => {
    const dag = dagOf({ a: [], b: ["a"], c: ["a"], d: ["b", "c"] });

    const result = criticalPath(dag, weightsFrom({ a: 1, b: 2, c: 2, d: 1 }));

    expect(result).toEqual({ path: ["a", "b", "d"], weight: 4 });
  });

  it("breaks a tie between needs by node order, not by the order they are listed", () => {
    const dag = dagOf({ a: [], b: ["a"], c: ["a"], d: ["c", "b"] });

    const result = criticalPath(dag, weightsFrom({ a: 1, b: 2, c: 2, d: 1 }));

    expect(result.path).toEqual(["a", "b", "d"]);
  });

  it("breaks a tie between end nodes in favour of the one first in node order", () => {
    const dag = dagOf({ a: [], f: ["a"], e: ["a"] });

    const result = criticalPath(dag, weightsFrom({ a: 1, f: 3, e: 3 }));

    expect(result).toEqual({ path: ["a", "f"], weight: 4 });
  });

  it("returns a single node for an isolated graph member that is heaviest", () => {
    const dag = dagOf({ a: [], b: ["a"], lone: [] });

    const result = criticalPath(dag, weightsFrom({ a: 1, b: 1, lone: 9 }));

    expect(result).toEqual({ path: ["lone"], weight: 9 });
  });

  it("runs a zero-weight chain back to its start", () => {
    const dag = dagOf({ a: [], b: ["a"] });

    const result = criticalPath(dag, weightsFrom({ a: 0, b: 0 }));

    expect(result).toEqual({ path: ["a"], weight: 0 });
  });

  it("returns an empty path for an empty graph", () => {
    expect(criticalPath(dagOf({}), () => 1)).toEqual({ path: [], weight: 0 });
  });

  it("calls the weight function once per node, in node order", () => {
    const seen: string[] = [];
    criticalPath(dagOf({ a: [], b: ["a"], c: ["b"] }), (id) => {
      seen.push(id);

      return 1;
    });

    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("throws a CycleError when the graph is cyclic", () => {
    expect(() => criticalPath(dagOf({ a: ["a"] }), () => 1)).toThrow(
      CycleError,
    );
  });

  it("rejects a negative or non-finite weight", () => {
    const dag = dagOf({ a: [] });

    expect(() => criticalPath(dag, () => -1)).toThrow(RangeError);
    expect(() => criticalPath(dag, () => Number.NaN)).toThrow(RangeError);
    expect(() => criticalPath(dag, () => Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });
});
