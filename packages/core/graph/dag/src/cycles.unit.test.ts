import { describe, expect, it } from "vitest";
import {
  assertAcyclic,
  findCycles,
  stronglyConnectedComponents,
} from "./cycles.ts";
import { CycleError } from "./errors.ts";
import { dagOf } from "./test-support/dag-of.ts";

/** Far deeper than any call stack tolerates in a recursive walk, so an accidental recursion fails here. */
const deepRingLength = 100_000;

describe("findCycles", () => {
  it("returns nothing for an acyclic graph", () => {
    expect(findCycles(dagOf({ a: [], b: ["a"], c: ["a", "b"] }))).toEqual([]);
  });

  it("reports a cycle with its exact path, closed on its first node", () => {
    expect(findCycles(dagOf({ a: ["b"], b: ["c"], c: ["a"] }))).toEqual([
      ["a", "b", "c", "a"],
    ]);
  });

  it("starts the path at the component's earliest node in node order", () => {
    expect(findCycles(dagOf({ x: [], c: ["b"], b: ["a"], a: ["c"] }))).toEqual([
      ["c", "b", "a", "c"],
    ]);
  });

  it("reports a self-loop as a path of one node", () => {
    expect(findCycles(dagOf({ a: ["a"], b: ["a"] }))).toEqual([["a", "a"]]);
  });

  it("reports one cycle per strongly connected component, ordered by first node", () => {
    const cycles = findCycles(
      dagOf({ p: ["q"], q: ["p"], m: [], r: ["s"], s: ["r"], t: ["p", "r"] }),
    );

    expect(cycles).toEqual([
      ["p", "q", "p"],
      ["r", "s", "r"],
    ]);
  });

  it("reports the shortest cycle through the component's first node", () => {
    const cycles = findCycles(
      dagOf({ a: ["b", "c"], b: ["d"], c: ["a"], d: ["a"] }),
    );

    expect(cycles).toEqual([["a", "c", "a"]]);
  });

  it("leaves a node that merely needs a cycle out of its path", () => {
    expect(findCycles(dagOf({ a: ["b"], b: ["a"], c: ["a"] }))).toEqual([
      ["a", "b", "a"],
    ]);
  });

  it("orders paths by node order even when a later component is found first", () => {
    const cycles = findCycles(
      dagOf({ p: ["q", "r"], q: ["p"], r: ["s"], s: ["r"] }),
    );

    expect(cycles).toEqual([
      ["p", "q", "p"],
      ["r", "s", "r"],
    ]);
  });

  it("finds a cycle that also needs a node already settled elsewhere", () => {
    expect(findCycles(dagOf({ y: [], a: ["y", "b"], b: ["a"] }))).toEqual([
      ["a", "b", "a"],
    ]);
  });

  it("keeps a node above a cycle out of the cycle's component", () => {
    expect(findCycles(dagOf({ r: ["c"], c: ["d"], d: ["c"] }))).toEqual([
      ["c", "d", "c"],
    ]);
  });

  it("reports a cycle once when its nodes are reached from an earlier node", () => {
    expect(findCycles(dagOf({ a: ["b"], b: ["c"], c: ["b"] }))).toEqual([
      ["b", "c", "b"],
    ]);
  });

  it("follows the earliest needs when two shortest cycles tie", () => {
    expect(
      findCycles(dagOf({ a: ["b", "c"], b: ["d"], c: ["d"], d: ["a"] })),
    ).toEqual([["a", "b", "d", "a"]]);
  });

  it("ignores unknown references", () => {
    expect(findCycles(dagOf({ a: ["ghost"] }))).toEqual([]);
  });

  it("handles a ring longer than the call stack", () => {
    const table: Record<string, string[]> = {};
    for (let index = 0; index < deepRingLength; index += 1) {
      table[`n${String(index)}`] = [`n${String((index + 1) % deepRingLength)}`];
    }

    const [cycle] = findCycles(dagOf(table));

    expect(cycle).toHaveLength(deepRingLength + 1);
    expect(cycle?.[0]).toBe("n0");
    expect(cycle?.[deepRingLength]).toBe("n0");
  });
});

describe("assertAcyclic", () => {
  it("passes for an acyclic graph", () => {
    expect(() => {
      assertAcyclic(dagOf({ a: [], b: ["a"] }));
    }).not.toThrow();
  });

  it("throws a CycleError carrying every cycle", () => {
    const thrown = (() => {
      try {
        assertAcyclic(dagOf({ a: ["b"], b: ["a"], c: ["c"] }));
      } catch (error: unknown) {
        return error;
      }

      return undefined;
    })();

    expect(thrown).toBeInstanceOf(CycleError);
    expect(thrown instanceof CycleError && thrown.cycles).toEqual([
      ["a", "b", "a"],
      ["c", "c"],
    ]);
  });
});

describe("stronglyConnectedComponents", () => {
  it("puts every node in exactly one component, mutually reachable nodes together", () => {
    const components = stronglyConnectedComponents(
      dagOf({ p: ["q"], q: ["p"], m: [], r: ["s"], s: ["r", "t"], t: ["t"] }),
    );

    const sorted = components
      .map((component) => component.toSorted((a, b) => a.localeCompare(b)))
      .toSorted((a, b) => a.join().localeCompare(b.join()));

    expect(sorted).toEqual([["m"], ["p", "q"], ["r", "s"], ["t"]]);
  });

  it("lists a component before every component that needs it", () => {
    expect(
      stronglyConnectedComponents(dagOf({ a: [], b: ["a"], c: ["b"] })),
    ).toEqual([["a"], ["b"], ["c"]]);
  });

  it("partitions a ring deeper than any call stack without recursing", () => {
    const ring = Object.fromEntries(
      Array.from({ length: deepRingLength }, (_, index) => [
        `n${String(index)}`,
        [`n${String((index + 1) % deepRingLength)}`],
      ]),
    );

    expect(stronglyConnectedComponents(dagOf(ring))).toHaveLength(1);
  });
});
